"""Dataset routes.

Public API endpoints used by the frontend:
- POST /upload: upload a file and create a Dataset + initial snapshot
- GET /datasets: list the current user's datasets
- GET /dataset/{id}: "workspace" view for a dataset (dataset + warnings/suggestions)
- POST /dataset/{id}/result: simplified save flow (replace current vs save as new dataset)
- DELETE /dataset/{id}: delete a dataset owned by the current user

Notes:
- Ownership is enforced by `get_owned_dataset()` in the service layer.
- The UI does not expose dataset "version history"; snapshots are internal.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.dataset_version import DatasetVersion
from app.schemas.dataset import (
    CreateDatasetVersionRequest,
    DeleteDatasetResponse,
    DatasetRead,
    DatasetUploadResponse,
    DatasetVersionRead,
    DatasetWorkspaceRead,
    ExportDatasetRequest,
    SaveResultRequest,
    SaveResultResponse,
)
from app.services.dataset_snapshot import snapshot_to_export_bytes
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
    """Extract a Bearer token from the Authorization header."""
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
    """Upload a dataset file and create a new Dataset for the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await create_dataset_from_upload(db=db, upload_file=file, owner=owner, description=description)
    return {"message": "Dataset uploaded successfully", "dataset": dataset}


@router.get("/dataset/{dataset_id}", response_model=DatasetWorkspaceRead)
async def get_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Return a dataset "workspace" response (dataset + computed guidance)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    warnings, suggestions = get_workspace_guidance(dataset)
    return {"dataset": dataset, "warnings": warnings, "suggestions": suggestions}


@router.get("/datasets", response_model=list[DatasetRead])
async def list_datasets(authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """List datasets belonging to the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    return await list_user_datasets(db, owner)


@router.delete("/dataset/{dataset_id}", response_model=DeleteDatasetResponse)
async def delete_dataset(dataset_id: int, authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """Delete a dataset (and dependent rows) owned by the logged-in user."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)
    await delete_owned_dataset(db, dataset)
    return {"message": "Dataset deleted successfully."}


@router.post("/dataset/{dataset_id}/export")
async def export_dataset(
    dataset_id: int,
    payload: ExportDatasetRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Export the current dataset/result as CSV/XLSX/JSON.

If the client provides a `data_snapshot`, the export is generated from that snapshot
(useful for exporting an unsaved session result). Otherwise, the dataset's current
stored snapshot is exported.
    """

    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
    if snapshot is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No dataset data is available to export.")

    file_bytes, media_type, extension = snapshot_to_export_bytes(snapshot, export_format=payload.format)
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    safe_name = "dataset"
    filename = f"{safe_name}-{dataset.id}-{timestamp}.{extension}"

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/dataset/{dataset_id}/versions", response_model=DatasetVersionRead)
async def save_dataset_version(
    dataset_id: int,
    payload: CreateDatasetVersionRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Create a new dataset snapshot (internal "version") for a dataset.

Kept for compatibility; the simplified UI generally uses /result instead.
    """
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
    """Save an analysis/cleaning result.

Two modes:
- replace_current=True: append a snapshot and set it as current
- replace_current=False: create a brand-new dataset from the provided/current snapshot
    """
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    snapshot = payload.data_snapshot if payload.data_snapshot is not None else dataset.current_snapshot
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


@router.get("/dataset/{dataset_id}/rows")
async def get_dataset_rows(
    dataset_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return a paginated slice of the full dataset rows."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, dataset_id, owner)

    version = await db.scalar(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.desc())
        .limit(1)
    )
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No version found for this dataset.")

    records: list[dict] = (version.data_snapshot or {}).get("records", [])
    return {
        "rows": records[offset : offset + limit],
        "total": len(records),
        "offset": offset,
        "limit": limit,
    }
