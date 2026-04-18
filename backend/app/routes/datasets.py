from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.dataset import (
    CreateDatasetVersionRequest,
    DeleteDatasetResponse,
    DatasetRead,
    DatasetUploadResponse,
    DatasetVersionRead,
    DatasetWorkspaceRead,
    SaveResultRequest,
    SaveResultResponse,
)
from app.services.auth_service import get_user_by_token
from app.services.dataset_service import (
    create_dataset_from_upload,
    create_dataset_from_snapshot,
    create_dataset_version,
    delete_owned_dataset,
    get_owned_dataset,
    get_workspace_guidance,
    list_user_datasets,
)

router = APIRouter()


def _get_current_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    return authorization.removeprefix("Bearer ").strip()


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    description: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await create_dataset_from_upload(db=db, upload_file=file, owner=owner, description=description)
    return {"message": "Dataset uploaded successfully", "dataset": dataset}


@router.get("/dataset/{dataset_id}", response_model=DatasetWorkspaceRead)
async def get_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    warnings, suggestions = get_workspace_guidance(dataset)
    return {"dataset": dataset, "warnings": warnings, "suggestions": suggestions}


@router.get("/datasets", response_model=list[DatasetRead])
async def list_datasets(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    return await list_user_datasets(db, owner)


@router.delete("/dataset/{dataset_id}", response_model=DeleteDatasetResponse)
async def delete_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    await delete_owned_dataset(db, dataset)
    return {"message": "Dataset deleted successfully."}


@router.post("/dataset/{dataset_id}/versions", response_model=DatasetVersionRead)
async def save_dataset_version(
    dataset_id: int,
    payload: CreateDatasetVersionRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    version = await create_dataset_version(db, dataset, payload)
    return version


@router.post("/dataset/{dataset_id}/result", response_model=SaveResultResponse)
async def save_dataset_result(
    dataset_id: int,
    payload: SaveResultRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot or dataset.current_snapshot
    if snapshot is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No saved result is available.")

    if payload.replace_current:
        version = await create_dataset_version(
            db,
            dataset,
            CreateDatasetVersionRequest(operation_type="result", replace_current=True, data_snapshot=snapshot),
        )
        updated_dataset = await get_owned_dataset(db, dataset.id, owner)
        return {"message": "Result replaced the current dataset.", "dataset": updated_dataset}

    dataset_name = (payload.dataset_name or "").strip()
    if not dataset_name:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dataset name is required.")

    created_dataset = await create_dataset_from_snapshot(
        db=db,
        owner=owner,
        name=dataset_name,
        file_type=dataset.file_type,
        description=payload.description or dataset.description,
        snapshot=snapshot,
        action_type="result",
        action_input_params={"source_dataset_id": dataset.id, "source_dataset_name": dataset.name},
    )
    return {"message": "Result saved as a new dataset.", "dataset": created_dataset}
