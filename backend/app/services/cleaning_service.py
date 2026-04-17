from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from app.schemas.cleaning import CleaningIssue, CleaningOperation
from app.services.dataset_snapshot import build_snapshot, snapshot_to_dataframe


def _infer_column_type(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"

    non_null = series.dropna().astype(str).str.strip()
    if non_null.empty:
        return "unknown"

    numeric_ratio = pd.to_numeric(non_null, errors="coerce").notna().mean()
    datetime_ratio = pd.to_datetime(non_null, errors="coerce").notna().mean()

    if numeric_ratio >= 0.8:
        return "numeric_string"
    if datetime_ratio >= 0.8:
        return "datetime_string"

    unique_ratio = series.nunique(dropna=True) / max(len(non_null), 1)
    if unique_ratio <= 0.5:
        return "categorical"
    return "text"


def _build_detection(frame: pd.DataFrame) -> tuple[dict[str, int], int, dict[str, str], list[CleaningIssue]]:
    missing_values = {str(column): int(frame[column].isna().sum()) for column in frame.columns}
    duplicates = int(frame.duplicated().sum())
    column_types: dict[str, str] = {}
    issues: list[CleaningIssue] = []

    for column in frame.columns:
        series = frame[column]
        inferred_type = _infer_column_type(series)
        column_name = str(column)
        column_types[column_name] = inferred_type

        missing_count = int(series.isna().sum())
        if missing_count > 0:
            issues.append(
                CleaningIssue(
                    kind="missing_values",
                    column=column_name,
                    severity="warning",
                    message=f"{missing_count} missing values detected in {column_name}.",
                    suggestion="Fill missing values or drop rows depending on the data use case.",
                    details={"missing_values": missing_count},
                )
            )

        if inferred_type == "numeric_string":
            issues.append(
                CleaningIssue(
                    kind="type_inconsistency",
                    column=column_name,
                    severity="warning",
                    message=f"{column_name} appears numeric but is stored as text.",
                    suggestion="Use convert_column_type to convert this column to numeric.",
                    details={"inferred_type": inferred_type},
                )
            )
        elif inferred_type == "datetime_string":
            issues.append(
                CleaningIssue(
                    kind="type_inconsistency",
                    column=column_name,
                    severity="warning",
                    message=f"{column_name} appears to contain datetime values stored as text.",
                    suggestion="Use convert_column_type to convert this column to datetime.",
                    details={"inferred_type": inferred_type},
                )
            )

    if duplicates > 0:
        issues.append(
            CleaningIssue(
                kind="duplicates",
                severity="warning",
                message=f"{duplicates} duplicate rows detected.",
                suggestion="Remove duplicate rows before saving or exporting.",
                details={"duplicate_rows": duplicates},
            )
        )

    return missing_values, duplicates, column_types, issues


def _ensure_columns(frame: pd.DataFrame, columns: list[str]) -> None:
    missing_columns = [column for column in columns if column not in frame.columns]
    if missing_columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown column(s): {', '.join(missing_columns)}",
        )


def _convert_boolean_series(series: pd.Series, errors: str) -> pd.Series:
    true_values = {"true", "1", "yes", "y", "t"}
    false_values = {"false", "0", "no", "n", "f"}

    def convert(value: Any) -> Any:
        if pd.isna(value):
            return None
        normalized = str(value).strip().lower()
        if normalized in true_values:
            return True
        if normalized in false_values:
            return False
        if errors == "raise":
            raise ValueError(f"Cannot convert value '{value}' to boolean.")
        if errors == "ignore":
            return value
        return None

    return series.map(convert)


def _convert_column_type(series: pd.Series, target_type: str, errors: str) -> pd.Series:
    if target_type == "numeric":
        return pd.to_numeric(series, errors=errors)
    if target_type == "datetime":
        return pd.to_datetime(series, errors=errors)
    if target_type == "string":
        return series.astype("string")
    if target_type == "categorical":
        return series.astype("category")
    if target_type == "boolean":
        return _convert_boolean_series(series, errors)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported target type: {target_type}",
    )


async def get_dataset_source_version(
    db: AsyncSession,
    dataset: Dataset,
    dataset_version_id: int | None = None,
) -> DatasetVersion:
    if dataset_version_id is not None:
        result = await db.execute(
            select(DatasetVersion).where(
                DatasetVersion.id == dataset_version_id,
                DatasetVersion.dataset_id == dataset.id,
            )
        )
        version = result.scalar_one_or_none()
        if version is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset version not found.")
        return version

    if dataset.current_version is not None:
        return dataset.current_version

    result = await db.execute(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.version_number.desc())
    )
    version = result.scalars().first()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset version not found.")
    return version


async def detect_cleaning_issues(
    db: AsyncSession,
    dataset: Dataset,
    dataset_version_id: int | None = None,
) -> tuple[DatasetVersion, dict[str, int], int, dict[str, str], list[CleaningIssue]]:
    version = await get_dataset_source_version(db, dataset, dataset_version_id)
    frame = snapshot_to_dataframe(version.data_snapshot)
    missing_values, duplicates, column_types, issues = _build_detection(frame)
    return version, missing_values, duplicates, column_types, issues


def _apply_operation(frame: pd.DataFrame, operation: CleaningOperation) -> pd.DataFrame:
    if operation.operation_type in {"fill_mean", "fill_median", "fill_mode"}:
        columns = operation.columns or list(frame.columns)
        _ensure_columns(frame, columns)

    if operation.operation_type == "fill_mean":
        for column in columns:
            series = frame[column]
            if not pd.api.types.is_numeric_dtype(series):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"fill_mean can only be applied to numeric columns. Column '{column}' is not numeric.",
                )
            mean_value = series.mean()
            frame[column] = series.fillna(mean_value)
        return frame

    if operation.operation_type == "fill_median":
        for column in columns:
            series = frame[column]
            if not pd.api.types.is_numeric_dtype(series):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"fill_median can only be applied to numeric columns. Column '{column}' is not numeric.",
                )
            median_value = series.median()
            frame[column] = series.fillna(median_value)
        return frame

    if operation.operation_type == "fill_mode":
        for column in columns:
            series = frame[column]
            mode_values = series.mode(dropna=True)
            if not mode_values.empty:
                frame[column] = series.fillna(mode_values.iloc[0])
        return frame

    if operation.operation_type == "drop_rows":
        columns = operation.columns
        if columns:
            _ensure_columns(frame, columns)
            return frame.dropna(subset=columns)
        return frame.dropna(how="any" if operation.drop_all_missing else "all")

    if operation.operation_type == "remove_all_duplicates":
        return frame.drop_duplicates()

    if operation.operation_type == "convert_column_type":
        if not operation.column:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="convert_column_type requires a column name.",
            )
        if not operation.target_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="convert_column_type requires a target_type.",
            )
        _ensure_columns(frame, [operation.column])
        frame[operation.column] = _convert_column_type(frame[operation.column], operation.target_type, operation.errors)
        return frame

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported cleaning operation: {operation.operation_type}",
    )


def apply_cleaning_operations(frame: pd.DataFrame, operations: list[CleaningOperation]) -> tuple[pd.DataFrame, list[CleaningOperation]]:
    working_frame = frame.copy()
    applied_operations: list[CleaningOperation] = []

    for operation in operations:
        working_frame = _apply_operation(working_frame, operation)
        applied_operations.append(operation)

    return working_frame, applied_operations


def build_cleaning_result_snapshot(
    frame: pd.DataFrame,
    *,
    source_name: str,
    file_type: str,
    size_bytes: int,
) -> dict:
    return build_snapshot(
        frame,
        source_name=source_name,
        file_type=file_type,
        size_bytes=size_bytes,
    )


def analyze_cleaning_frame(frame: pd.DataFrame) -> tuple[dict[str, int], int, dict[str, str], list[CleaningIssue]]:
    return _build_detection(frame)

