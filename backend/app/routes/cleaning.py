#This is the cleaning.py in route api in the backend

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.cleaning import CleanApplyRequest, CleanApplyResponse, CleanDetectRequest, CleanDetectResponse
from app.services.auth_service import get_user_by_token
from app.services.cleaning_service import (
    apply_cleaning_operations,
    analyze_cleaning_frame,
    build_cleaning_result_snapshot,
    detect_cleaning_issues,
)
from app.services.dataset_snapshot import snapshot_to_dataframe
from app.services.dataset_service import get_owned_dataset

router = APIRouter(prefix="/clean", tags=["cleaning"])


def _get_current_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    return authorization.removeprefix("Bearer ").strip()


@router.post("/detect", response_model=CleanDetectResponse)
async def detect_cleaning(
    payload: CleanDetectRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    version, missing_values, duplicates, column_types, issues = await detect_cleaning_issues(
        db,
        dataset,
        payload.dataset_version_id,
    )
    return {
        "dataset_id": dataset.id,
        "dataset_version_id": version.id,
        "missing_values": missing_values,
        "duplicates": duplicates,
        "column_types": column_types,
        "issues": issues,
    }


@router.post("/apply", response_model=CleanApplyResponse)
async def apply_cleaning(
    payload: CleanApplyRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    version, missing_values, duplicates, column_types, issues = await detect_cleaning_issues(
        db,
        dataset,
        payload.dataset_version_id,
    )

    frame = snapshot_to_dataframe(version.data_snapshot)
    cleaned_frame, applied_operations = apply_cleaning_operations(frame, payload.cleaning_operations)
    cleaned_snapshot = build_cleaning_result_snapshot(
        cleaned_frame,
        source_name=dataset.name,
        file_type=dataset.file_type,
        size_bytes=int(cleaned_frame.memory_usage(index=True, deep=True).sum()),
    )

    cleaned_missing_values, cleaned_duplicates, cleaned_column_types, cleaned_issues = analyze_cleaning_frame(cleaned_frame)
    return {
        "dataset_id": dataset.id,
        "dataset_version_id": version.id,
        "source_version_id": version.id,
        "operations_applied": applied_operations,
        "missing_values": cleaned_missing_values,
        "duplicates": cleaned_duplicates,
        "column_types": cleaned_column_types,
        "issues": cleaned_issues,
        "preview": cleaned_snapshot["preview"],
        "summary": cleaned_snapshot["summary"],
        "data_snapshot": cleaned_snapshot,
    }