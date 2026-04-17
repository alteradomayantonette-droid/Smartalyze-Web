from __future__ import annotations

from io import BytesIO

import pandas as pd
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.models.auth import User
from app.models.dataset_action import DatasetAction
from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from app.schemas.dataset import CreateDatasetVersionRequest
from app.services.dataset_snapshot import build_snapshot

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json"}
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
            detail="Unsupported file type. Use CSV, Excel, or JSON.",
        )

    buffer = BytesIO(file_bytes)
    if extension == ".csv":
        frame = pd.read_csv(buffer)
        file_format = "csv"
    elif extension in {".xlsx", ".xls"}:
        frame = pd.read_excel(buffer)
        file_format = "excel"
    else:
        frame = pd.read_json(buffer)
        file_format = "json"

    if frame.empty and frame.shape[1] == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file does not contain any usable tabular data.",
        )

    return frame, file_format


async def create_dataset_from_upload(
    db: AsyncSession,
    upload_file: UploadFile,
    owner: User,
    description: str | None = None,
) -> Dataset:
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

    dataset = Dataset(
        user_id=owner.id,
        name=original_filename,
        file_type=file_format,
        description=description,
    )

    db.add(dataset)
    await db.flush()

    version = DatasetVersion(
        dataset_id=dataset.id,
        version_number=1,
        operation_type="original",
        data_snapshot=snapshot,
    )
    db.add(version)
    await db.flush()
    dataset.current_version_id = version.id

    db.add(
        DatasetAction(
            dataset_id=dataset.id,
            action_type="original",
            input_params={"source_name": original_filename, "file_type": file_format},
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
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.current_version))
        .where(Dataset.user_id == owner.id)
        .order_by(Dataset.created_at.desc())
    )
    return list(result.scalars().all())


async def get_owned_dataset(db: AsyncSession, dataset_id: int, owner: User) -> Dataset:
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
    result = await db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.asc())
    )
    return list(result.scalars().all())


def get_workspace_guidance(dataset: Dataset) -> tuple[list[dict], list[dict]]:
    return _build_workspace_guidance(dataset)


async def create_dataset_version(
    db: AsyncSession,
    dataset: Dataset,
    payload: CreateDatasetVersionRequest,
) -> DatasetVersion:
    result = await db.execute(
        select(DatasetVersion.version_number)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.desc())
    )
    latest_version_number = result.scalar_one_or_none()
    version_number = (latest_version_number or 0) + 1

    source_snapshot = payload.data_snapshot or dataset.current_snapshot or {
        "source_name": dataset.name,
        "file_type": dataset.file_type,
        "size_bytes": 0,
        "records": [],
        "columns": [],
        "preview": [],
        "summary": {"row_count": 0, "column_count": 0, "missing_cells": 0, "duplicate_rows": 0, "size_bytes": 0},
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
