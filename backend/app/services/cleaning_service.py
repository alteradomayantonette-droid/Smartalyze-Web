from __future__ import annotations

"""Cleaning service.

This module contains the "business logic" for detecting issues in a dataset snapshot
and applying cleaning operations.

Flow used by the API routes:
- Resolve a dataset version (explicit `dataset_version_id` or dataset.current_version)
- Convert snapshot -> DataFrame
- Detect issues / apply operations
- Convert DataFrame -> snapshot for returning to the client
"""

import re
import warnings
from typing import Any

import pandas as pd
from dateutil import parser as dateutil_parser
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from app.schemas.cleaning import CleaningIssue, CleaningOperation, PatternImputationResult
from app.services.dataset_snapshot import build_snapshot, snapshot_to_dataframe
from app.services.pattern_imputation_service import apply_pattern_fill, find_pattern_suggestions


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
    # Try both month-first and day-first to handle mixed/ambiguous date formats.
    # Pandas can emit a noisy warning when it falls back to element-wise parsing.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Could not infer format, so each element will be parsed individually*",
            category=UserWarning,
        )
        dt_mf = pd.to_datetime(non_null, errors="coerce", dayfirst=False).notna().mean()
        dt_df = pd.to_datetime(non_null, errors="coerce", dayfirst=True).notna().mean()
        datetime_ratio = max(dt_mf, dt_df)

    if numeric_ratio >= 0.8:
        return "numeric_string"
    if datetime_ratio >= 0.5:
        return "datetime_string"

    unique_ratio = series.nunique(dropna=True) / max(len(non_null), 1)
    if unique_ratio <= 0.5:
        return "categorical"
    return "text"


def _column_decimal_places(series: pd.Series) -> int:
    """Return the max number of decimal places seen in a numeric series' non-null values.

    Used to round fill values (mean/median) so they match the column's existing precision
    instead of inheriting the full float representation of the statistic.
    Examples: [85.0, 68.0] → 1 decimal;  [85.5, 68.25] → 2 decimals;  int64 → 0 decimals.
    """
    if pd.api.types.is_integer_dtype(series):
        return 0
    non_null = series.dropna()
    if non_null.empty:
        return 2
    max_dp = 0
    for v in non_null.head(100):
        text = str(float(v))
        if "e" in text.lower() or "." not in text:
            continue
        max_dp = max(max_dp, len(text.split(".")[1]))
    return min(max_dp, 6)


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


_DATE_OUTPUT_FORMATS = {
    "iso": "%Y-%m-%d",
    "us": "%m/%d/%Y",
    "eu": "%d/%m/%Y",
}
# Tokenization for "thin input" rejection: anything that's not alphanumeric is a separator.
# A bare "5" yields one token; "Jan 7 24" yields three. dateutil happily fills missing parts
# with today's date, so we refuse to call it on inputs with fewer than 3 tokens.
_DATE_TOKEN_RE = re.compile(r"[A-Za-z]+|\d+")
# Year-first ISO-like pattern: YYYY[-/.]M[D][-/.]D[D] (optionally followed by a time part).
# These are unambiguous regardless of dayfirst, so we treat the regex match as "this is ISO,
# do not let dayfirst flip the day/month." Failure inside this branch is final — we don't
# fall through to a permissive parser that would mis-rescue invalid dates like 2024-13-01.
_ISO_DATE_RE = re.compile(r"^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[\sT].*)?\s*$")
# Year-last numeric pattern A[sep]B[sep]Y — used to count "decisive" votes
# (a > 12 means A must be the day; b > 12 means B must be the day).
_DAY_MONTH_RE = re.compile(r"^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}(?:[\sT].*)?\s*$")


def _infer_dayfirst(series: pd.Series, sample_size: int = 200) -> bool:
    non_null = series.dropna().astype(str).str.strip()
    non_null = non_null[non_null != ""]
    if non_null.empty:
        return False

    # ISO-like values are unambiguous and should not influence the day/month vote —
    # otherwise an invalid month like "2024-13-01" can only parse under dayfirst=True
    # (pandas falls back to DD-MM-YYYY) and tips the inference for the whole column.
    ambiguous = non_null[~non_null.str.match(_ISO_DATE_RE)]
    if ambiguous.empty:
        return False

    # Strong evidence: count values where one position is > 12 (and so MUST be the day).
    day_first_votes = 0
    month_first_votes = 0
    for value in ambiguous.head(sample_size):
        match = _DAY_MONTH_RE.match(value)
        if not match:
            continue
        first, second = int(match.group(1)), int(match.group(2))
        if first > 12 and second <= 12:
            day_first_votes += 1
        elif first <= 12 and second > 12:
            month_first_votes += 1
    if day_first_votes != month_first_votes:
        return day_first_votes > month_first_votes

    # No decisive evidence → fall back to "which flag parses more cells."
    sample = ambiguous.head(sample_size)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=UserWarning)
        mf_hits = pd.to_datetime(sample, errors="coerce", dayfirst=False).notna().sum()
        df_hits = pd.to_datetime(sample, errors="coerce", dayfirst=True).notna().sum()

    # Tie or month-first wins → False (matches existing default behavior elsewhere).
    return bool(df_hits > mf_hits)


def _parse_one_date(value: Any, dayfirst: bool) -> pd.Timestamp | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value

    text = str(value).strip()
    if not text:
        return None
    if len(_DATE_TOKEN_RE.findall(text)) < 3:
        return None

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=UserWarning)
        # ISO-looking inputs are parsed strictly with dayfirst=False. If the strict parse
        # fails (e.g. month=13), we return None instead of falling through, since a permissive
        # fallback would silently rescue invalid dates by swapping day/month.
        if _ISO_DATE_RE.match(text):
            try:
                return pd.to_datetime(text, errors="raise", dayfirst=False)
            except (ValueError, TypeError, OverflowError):
                return None

        try:
            return pd.to_datetime(text, errors="raise", dayfirst=dayfirst)
        except (ValueError, TypeError, OverflowError):
            pass

    try:
        return pd.Timestamp(dateutil_parser.parse(text, dayfirst=dayfirst))
    except (ValueError, TypeError, OverflowError):
        return None


def _standardize_dates(
    series: pd.Series,
    output_format: str,
    dayfirst_hint: str,
    unparseable_action: str,
) -> tuple[pd.Series, list[dict[str, Any]]]:
    strftime_fmt = _DATE_OUTPUT_FORMATS.get(output_format)
    if strftime_fmt is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported output_format: {output_format}",
        )

    if dayfirst_hint == "day":
        dayfirst = True
    elif dayfirst_hint == "month":
        dayfirst = False
    else:
        dayfirst = _infer_dayfirst(series)

    unparseable: list[dict[str, Any]] = []
    new_values: list[Any] = []
    for row_idx, original in series.items():
        if original is None or (isinstance(original, float) and pd.isna(original)):
            new_values.append(original)
            continue

        parsed = _parse_one_date(original, dayfirst)
        if parsed is None:
            unparseable.append({"row": int(row_idx), "original": str(original)})
            if unparseable_action == "null":
                new_values.append(None)
            else:
                new_values.append(original)
        else:
            new_values.append(parsed.strftime(strftime_fmt))

    return pd.Series(new_values, index=series.index, dtype="object"), unparseable


def _text_columns(frame: pd.DataFrame, columns: list[str] | None = None) -> list[str]:
    if columns is not None:
        _ensure_columns(frame, columns)
        return columns

    return [str(column) for column in frame.columns if pd.api.types.is_string_dtype(frame[column]) or pd.api.types.is_object_dtype(frame[column])]


async def get_dataset_source_version(
    db: AsyncSession,
    dataset: Dataset,
    dataset_version_id: int | None = None,
) -> DatasetVersion:
    """Pick the snapshot/version to operate on.

If `dataset_version_id` is provided, it must belong to the dataset.
Otherwise we fall back to the dataset's current version (or latest version).
    """
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
) -> tuple[DatasetVersion, dict[str, int], int, dict[str, str], list[CleaningIssue], list[PatternImputationResult]]:
    """Return (version, missing_values, duplicates, column_types, issues, pattern_suggestions)."""
    version = await get_dataset_source_version(db, dataset, dataset_version_id)
    frame = snapshot_to_dataframe(version.data_snapshot)
    missing_values, duplicates, column_types, issues = _build_detection(frame)
    cols_with_missing = [col for col, count in missing_values.items() if count > 0]
    pattern_suggestions = find_pattern_suggestions(frame, cols_with_missing)
    return version, missing_values, duplicates, column_types, issues, pattern_suggestions


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
            dp = _column_decimal_places(series)
            mean_value = round(series.mean(), dp)
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
            dp = _column_decimal_places(series)
            median_value = round(series.median(), dp)
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

    if operation.operation_type == "trim_whitespace":
        columns = _text_columns(frame, operation.columns or None)
        for column in columns:
            frame[column] = frame[column].astype("string").str.strip()
        return frame

    if operation.operation_type == "standardize_dates":
        if not operation.column:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="standardize_dates requires a column name.",
            )
        _ensure_columns(frame, [operation.column])
        output_format = operation.output_format or "iso"
        new_series, unparseable_rows = _standardize_dates(
            frame[operation.column],
            output_format,
            operation.dayfirst_hint,
            operation.unparseable_action,
        )
        frame[operation.column] = new_series
        # Stash for the route to surface in the response summary. frame.attrs is a
        # pandas-native side-channel that survives column assignments on the same frame.
        unparseable_map = frame.attrs.setdefault("_standardize_dates_unparseable", {})
        unparseable_map[operation.column] = unparseable_rows
        return frame

    if operation.operation_type == "lowercase_column":
        columns = operation.columns or ([operation.column] if operation.column else [])
        if not columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="lowercase_column requires at least one column.",
            )
        _ensure_columns(frame, columns)
        for column in columns:
            frame[column] = frame[column].astype("string").str.lower()
        return frame

    if operation.operation_type == "sort_values":
        if not operation.column:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="sort_values requires a column name.",
            )
        _ensure_columns(frame, [operation.column])
        ascending = bool(operation.ascending)
        try:
            return frame.sort_values(
                by=operation.column,
                ascending=ascending,
                na_position="last",
                kind="mergesort",
            )
        except TypeError:
            temp_key = "__smartalyze_sort_key__"
            working = frame.copy()
            working[temp_key] = working[operation.column].astype(str)
            working = working.sort_values(
                by=temp_key,
                ascending=ascending,
                na_position="last",
                kind="mergesort",
            )
            return working.drop(columns=[temp_key])

    if operation.operation_type == "fill_pattern":
        if not operation.column or not operation.key_column:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="fill_pattern requires both column (target) and key_column.",
            )
        _ensure_columns(frame, [operation.column, operation.key_column])
        return apply_pattern_fill(frame, operation.key_column, operation.column)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported cleaning operation: {operation.operation_type}",
    )


def apply_cleaning_operations(
    frame: pd.DataFrame, operations: list[CleaningOperation]
) -> tuple[pd.DataFrame, list[CleaningOperation], dict[str, list[dict[str, Any]]]]:
    """Apply operations sequentially.

    Returns the cleaned DataFrame, the list of applied operations, and a dict
    mapping column name -> list of unparseable rows from any standardize_dates ops.
    """
    working_frame = frame.copy()
    applied_operations: list[CleaningOperation] = []
    unparseable_dates: dict[str, list[dict[str, Any]]] = {}

    for operation in operations:
        working_frame = _apply_operation(working_frame, operation)
        applied_operations.append(operation)
        # Drain any unparseable info the operation stashed on the frame.
        stashed = working_frame.attrs.pop("_standardize_dates_unparseable", None)
        if stashed:
            unparseable_dates.update(stashed)

    return working_frame, applied_operations, unparseable_dates


def build_cleaning_result_snapshot(
    frame: pd.DataFrame,
    *,
    source_name: str,
    file_type: str,
    size_bytes: int,
) -> dict:
    """Build a JSON snapshot for a cleaned DataFrame (used as API output)."""
    return build_snapshot(
        frame,
        source_name=source_name,
        file_type=file_type,
        size_bytes=size_bytes,
    )


def analyze_cleaning_frame(frame: pd.DataFrame) -> tuple[dict[str, int], int, dict[str, str], list[CleaningIssue]]:
    """Re-run detection on an updated DataFrame (used after cleaning)."""
    return _build_detection(frame)

