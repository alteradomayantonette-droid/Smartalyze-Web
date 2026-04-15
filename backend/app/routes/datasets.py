from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.dataset import (
    CreateDatasetVersionRequest,
    DatasetRead,
    DatasetUploadResponse,
    DatasetVersionRead,
    DatasetWorkspaceRead,
)
from app.services.auth_service import get_user_by_token
from app.services.dataset_service import (
    create_dataset_from_upload,
    create_dataset_version,
    get_dataset_versions,
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
    versions = await get_dataset_versions(db, dataset)
    warnings, suggestions = get_workspace_guidance(dataset)
    return {"dataset": dataset, "versions": versions, "warnings": warnings, "suggestions": suggestions}


@router.get("/datasets", response_model=list[DatasetRead])
async def list_datasets(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    return await list_user_datasets(db, owner)


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
