from __future__ import annotations

"""Dataset service.

This module owns dataset business logic and DB operations.

Key concepts:
- Dataset: user-owned container (a "file" in the UI)
- DatasetVersion: stored snapshot of the dataset content (JSON)
- DatasetAction: lightweight audit log entry

Typical request flow:
- Routes validate Bearer token -> `get_user_by_token()`
- Routes enforce ownership -> `get_owned_dataset()`
- Routes call the appropriate service function (create/list/save/delete)
"""

from io import BytesIO

import pandas as pd
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.models.auth import User
from app.models.dataset_action import DatasetAction
from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from app.schemas.dataset import CreateDatasetVersionRequest
from app.services.dataset_snapshot import build_snapshot

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".png", ".jpg", ".jpeg"}
PREVIEW_ROWS = 10


def _normalize_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def _dataframe_preview(frame: pd.DataFrame) -> list[dict]:
    return [
        {column: _normalize_value(value) for column, value in record.items()}
        for record in frame.head(PREVIEW_ROWS).to_dict(orient="records")
    ]


def _build_column_metadata(frame: pd.DataFrame) -> list[dict]:
    metadata: list[dict] = []
    for column in frame.columns:
        series = frame[column]
        metadata.append(
            {
                "name": str(column),
                "data_type": str(series.dtype),
                "missing_values": int(series.isna().sum()),
                "non_null_values": int(series.notna().sum()),
                "unique_values": int(series.nunique(dropna=True)),
            }
        )
    return metadata


def _build_summary(frame: pd.DataFrame) -> dict:
    return {
        "row_count": int(frame.shape[0]),
        "column_count": int(frame.shape[1]),
        "missing_cells": int(frame.isna().sum().sum()),
        "duplicate_rows": int(frame.duplicated().sum()),
        "size_bytes": 0,
    }


def _build_workspace_guidance(dataset: Dataset) -> tuple[list[dict], list[dict]]:
    warnings: list[dict] = []
    suggestions: list[dict] = []
    summary = dataset.summary_json or {}
    columns = dataset.columns_json or []

    missing_cells = int(summary.get("missing_cells") or 0)
    duplicate_rows = int(summary.get("duplicate_rows") or 0)

    if missing_cells > 0:
        warnings.append(
            {
                "scope": "dataset",
                "severity": "warning",
                "message": f"{missing_cells} missing values detected in this dataset.",
            }
        )
        suggestions.append(
            {
                "scope": "dataset",
                "message": "Try cleaning missing values before exporting, or continue if the gaps are expected.",
            }
        )

    if duplicate_rows > 0:
        warnings.append(
            {
                "scope": "dataset",
                "severity": "warning",
                "message": f"{duplicate_rows} duplicate rows detected.",
            }
        )
        suggestions.append(
            {
                "scope": "dataset",
                "message": "You can remove duplicates now or keep them if they are valid repeated records.",
            }
        )

    for column in columns:
        missing_values = int(column.get("missing_values") or 0)
        data_type = str(column.get("data_type") or "unknown")
        name = str(column.get("name") or "column")

        if missing_values > 0:
            warnings.append(
                {
                    "scope": name,
                    "severity": "info",
                    "message": f"Missing values detected in {name}.",
                }
            )

        if data_type in {"object", "string"}:
            suggestions.append(
                {
                    "scope": name,
                    "message": f"{name} looks categorical. Frequency counts and grouping may be useful.",
                }
            )
        elif data_type.startswith("datetime"):
            suggestions.append(
                {
                    "scope": name,
                    "message": f"{name} looks datetime-based. Time trends and date grouping may be useful.",
                }
            )
        elif data_type in {"int64", "float64", "int32", "float32"}:
            suggestions.append(
                {
                    "scope": name,
                    "message": f"{name} looks numeric. Trends, averages, and prediction may be useful.",
                }
            )

    if not warnings:
        warnings.append(
            {
                "scope": "dataset",
                "severity": "success",
                "message": "No obvious data quality issues were detected.",
            }
        )

    return warnings, suggestions


def _build_snapshot(
    frame: pd.DataFrame,
    *,
    source_name: str,
    file_type: str,
    size_bytes: int,
) -> dict:
    summary = _build_summary(frame)
    summary["size_bytes"] = size_bytes
    return {
        "source_name": source_name,
        "file_type": file_type,
        "size_bytes": size_bytes,
        "records": [
            {column: _normalize_value(value) for column, value in record.items()}
            for record in frame.to_dict(orient="records")
        ],
        "columns": _build_column_metadata(frame),
        "preview": _dataframe_preview(frame),
        "summary": summary,
    }


def _read_dataframe(file_bytes: bytes, filename: str) -> tuple[pd.DataFrame, str]:
    extension = filename[filename.rfind(".") :].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Use CSV, Excel, JSON, or an image (PNG/JPG).",
        )

    buffer = BytesIO(file_bytes)
    if extension == ".csv":
        frame = pd.read_csv(buffer)
        file_format = "csv"
    elif extension in {".xlsx", ".xls"}:
        frame = pd.read_excel(buffer)
        file_format = "excel"
    elif extension in {".png", ".jpg", ".jpeg"}:
        try:
            from app.services.ocr_service import extract_table_from_image
            frame = extract_table_from_image(file_bytes)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"OCR extraction failed: {exc}",
            ) from exc
        file_format = "image"
    else:
        frame = pd.read_json(buffer)
        file_format = "json"

    # Reject files with no usable data: zero rows (catches header-only files, where
    # shape[1] > 0 but there's nothing beneath the header) or every cell null across
    # the whole frame. Deliberately NOT a row-count/size minimum -- small real
    # datasets (even 2-3 rows) must still be accepted.
    if frame.shape[0] == 0 or frame.notna().sum().sum() == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The uploaded file doesn't contain any usable data — it may be empty, "
                "contain only column headers, or have no non-missing values."
            ),
        )

    return frame, file_format


async def create_dataset_from_upload(
    db: AsyncSession,
    upload_file: UploadFile,
    owner: User,
    description: str | None = None,
) -> Dataset:
    """Create a dataset from an uploaded file.

Reads the uploaded bytes into a DataFrame, builds a snapshot, and delegates to
`create_dataset_from_snapshot()` to persist Dataset + initial DatasetVersion.
    """
    settings = get_settings()
    original_filename = upload_file.filename or "dataset"
    file_bytes = await upload_file.read()

    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {settings.max_upload_size_mb} MB upload limit.",
        )

    frame, file_format = _read_dataframe(file_bytes, original_filename)
    snapshot = build_snapshot(
        frame,
        source_name=original_filename,
        file_type=file_format,
        size_bytes=len(file_bytes),
    )

    return await create_dataset_from_snapshot(
        db=db,
        owner=owner,
        name=original_filename,
        file_type=file_format,
        description=description,
        snapshot=snapshot,
        action_type="original",
        action_input_params={"source_name": original_filename, "file_type": file_format},
    )


async def create_dataset_from_snapshot(
    db: AsyncSession,
    owner: User,
    *,
    name: str,
    file_type: str,
    description: str | None,
    snapshot: dict,
    action_type: str = "result",
    action_input_params: dict | None = None,
) -> Dataset:
    """Create a dataset from a pre-built snapshot.

Persists:
- Dataset row
- initial DatasetVersion (version_number=1)
- a DatasetAction record describing the action

Returns the dataset reloaded with its current_version relationship.
    """
    dataset = Dataset(
        user_id=owner.id,
        name=name,
        file_type=file_type,
        description=description,
    )

    db.add(dataset)
    await db.flush()

    version = DatasetVersion(
        dataset_id=dataset.id,
        version_number=1,
        operation_type=action_type,
        data_snapshot=snapshot,
    )
    db.add(version)
    await db.flush()
    dataset.current_version_id = version.id

    db.add(
        DatasetAction(
            dataset_id=dataset.id,
            action_type=action_type,
            input_params=action_input_params or {"source_name": name, "file_type": file_type},
            result_summary=snapshot["summary"],
        )
    )

    await db.commit()
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.current_version))
        .where(Dataset.id == dataset.id)
    )
    loaded_dataset = result.scalar_one()
    return loaded_dataset


async def list_user_datasets(db: AsyncSession, owner: User) -> list[Dataset]:
    """Return all datasets owned by the given user (most recent first)."""
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.current_version))
        .where(Dataset.user_id == owner.id)
        .order_by(Dataset.created_at.desc())
    )
    return list(result.scalars().all())


async def get_owned_dataset(db: AsyncSession, dataset_id: int, owner: User) -> Dataset:
    """Fetch a dataset by id and enforce that it belongs to the given user."""
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.current_version), selectinload(Dataset.versions))
        .where(Dataset.id == dataset_id, Dataset.user_id == owner.id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset


async def get_dataset_versions(db: AsyncSession, dataset: Dataset) -> list[DatasetVersion]:
    """Return all stored snapshots/versions for a dataset (ascending version_number)."""
    result = await db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.asc())
    )
    return list(result.scalars().all())


async def delete_owned_dataset(db: AsyncSession, dataset: Dataset) -> None:
    """Delete a dataset and commit.

Dependent rows (versions/actions) are deleted via ORM cascades + FK ON DELETE CASCADE.
    """
    await db.delete(dataset)
    await db.commit()


async def rename_owned_dataset(db: AsyncSession, dataset: Dataset, new_name: str) -> Dataset:
    """Rename a dataset in place and commit."""
    name = new_name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dataset name cannot be empty.")
    dataset.name = name
    await db.commit()
    await db.refresh(dataset)
    return dataset


def get_workspace_guidance(dataset: Dataset) -> tuple[list[dict], list[dict]]:
    """Compute warnings/suggestions shown in the dataset workspace UI."""
    return _build_workspace_guidance(dataset)


async def create_dataset_version(
    db: AsyncSession,
    dataset: Dataset,
    payload: CreateDatasetVersionRequest,
) -> DatasetVersion:
    """Create a new DatasetVersion snapshot.

If payload.replace_current is True, the dataset's `current_version_id` is moved to
the new version.
    """
    # Use an aggregate to safely retrieve a single value even when a dataset
    # has multiple versions.
    result = await db.execute(
        select(func.max(DatasetVersion.version_number)).where(DatasetVersion.dataset_id == dataset.id)
    )
    latest_version_number = result.scalar_one()
    version_number = (latest_version_number or 0) + 1

    if payload.data_snapshot is not None:
        source_snapshot = payload.data_snapshot
    elif dataset.current_snapshot is not None:
        source_snapshot = dataset.current_snapshot
    else:
        source_snapshot = {
            "source_name": dataset.name,
            "file_type": dataset.file_type,
            "size_bytes": 0,
            "records": [],
            "columns": [],
            "preview": [],
            "summary": {
                "row_count": 0,
                "column_count": 0,
                "missing_cells": 0,
                "duplicate_rows": 0,
                "size_bytes": 0,
            },
        }

    version = DatasetVersion(
        dataset_id=dataset.id,
        version_number=version_number,
        operation_type=payload.operation_type,
        data_snapshot=source_snapshot,
    )
    db.add(version)
    await db.flush()

    if payload.replace_current:
        dataset.current_version_id = version.id

    db.add(
        DatasetAction(
            dataset_id=dataset.id,
            action_type=payload.operation_type,
            input_params={"replace_current": payload.replace_current},
            result_summary={"version_id": version.id, "version_number": version.version_number},
        )
    )

    await db.commit()
    await db.refresh(version)
    return version


    # DIRI SUGOD

"""Non-destructive IQR outlier detection for SmartAlyze."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class IQRResult:
    column: str
    q1: float | None
    q3: float | None
    iqr: float | None
    lower_bound: float | None
    upper_bound: float | None
    flags: list[dict[str, Any]]


def detect_iqr_outliers(dataframe: pd.DataFrame, column: str) -> dict[str, Any]:
    """
    Calculate IQR fences and return outlier cell coordinates.

    This function does not modify the DataFrame.
    """

    if column not in dataframe.columns:
        raise KeyError(f"Unknown column: {column}")

    # Converts numeric-looking strings while safely ignoring invalid values.
    values = pd.to_numeric(dataframe[column], errors="coerce")

    # Exclude NaN, positive infinity, and negative infinity.
    valid = values.where(np.isfinite(values))
    valid_values = valid.dropna()

    if valid_values.empty:
        return asdict(
            IQRResult(
                column=column,
                q1=None,
                q3=None,
                iqr=None,
                lower_bound=None,
                upper_bound=None,
                flags=[],
            )
        )

    q1 = float(valid_values.quantile(0.25, interpolation="linear"))
    q3 = float(valid_values.quantile(0.75, interpolation="linear"))
    iqr = q3 - q1

    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr

    # Strict comparisons: values exactly on a fence are not flagged.
    outlier_mask = ((values < lower_bound) | (values > upper_bound)).fillna(False)

    flagged_positions = np.flatnonzero(outlier_mask.to_numpy())

    flags = [
        {
            "rowIndex": int(position),  # zero-based grid row position
            "rowId": _json_safe_index(dataframe.index[position]),
            "column": column,
            "value": float(values.iloc[position]),
        }
        for position in flagged_positions
    ]

    return asdict(
        IQRResult(
            column=column,
            q1=q1,
            q3=q3,
            iqr=iqr,
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            flags=flags,
        )
    )


def _json_safe_index(index_value: Any) -> str | int | float | bool | None:
    """Convert a DataFrame index value into a JSON-safe row identifier."""
    if pd.isna(index_value):
        return None

    if isinstance(index_value, (str, int, float, bool)):
        return index_value

    return str(index_value)

    from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from iqr_outliers import detect_iqr_outliers

router = APIRouter()


class IQRRequest(BaseModel):
    column: str


@router.post("/api/datasets/{dataset_id}/outliers/iqr")
def get_iqr_outliers(dataset_id: str, request: IQRRequest):
    # Replace this with your existing read-only dataset loader.
    dataframe = load_dataframe_for_dataset(dataset_id)

    try:
        return detect_iqr_outliers(dataframe, request.column)

    except KeyError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error


def apply_confirmed_outlier_action(
    dataset_id: str,
    confirmed: bool,
    flags: list[dict],
):
    """
    Keep any delete/replace/export action separate from detection.
    This must only run after explicit user confirmation.
    """
    if not confirmed:
        raise HTTPException(
            status_code=409,
            detail="Explicit user confirmation is required.",
        )

    # Add a user-selected modification action here only if needed.
    # The IQR analysis endpoint never calls this function.
