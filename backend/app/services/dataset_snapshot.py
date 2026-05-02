from __future__ import annotations

"""Snapshot helpers.

The app stores dataset content as a JSON "snapshot" so it can be:
- saved in the database (DatasetVersion.data_snapshot)
- converted to a pandas DataFrame for cleaning/analysis
- served to the frontend for previews/summary widgets

Snapshot shape (high-level):
{ source_name, file_type, size_bytes, records, columns, preview, summary }
"""

import json
from io import BytesIO
from typing import Any, Literal

import pandas as pd

PREVIEW_ROWS = 10


def normalize_value(value: Any) -> Any:
    """Convert pandas/numpy scalar values into JSON-friendly Python types."""
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def dataframe_preview(frame: pd.DataFrame) -> list[dict]:
    return [
        {column: normalize_value(value) for column, value in record.items()}
        for record in frame.head(PREVIEW_ROWS).to_dict(orient="records")
    ]


def build_column_metadata(frame: pd.DataFrame) -> list[dict]:
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


def build_summary(frame: pd.DataFrame, *, size_bytes: int = 0) -> dict:
    return {
        "row_count": int(frame.shape[0]),
        "column_count": int(frame.shape[1]),
        "missing_cells": int(frame.isna().sum().sum()),
        "duplicate_rows": int(frame.duplicated().sum()),
        "size_bytes": size_bytes,
    }


def build_snapshot(
    frame: pd.DataFrame,
    *,
    source_name: str,
    file_type: str,
    size_bytes: int,
) -> dict:
    """Build a snapshot dict from a DataFrame (records + preview + metadata)."""
    summary = build_summary(frame, size_bytes=size_bytes)
    return {
        "source_name": source_name,
        "file_type": file_type,
        "size_bytes": size_bytes,
        "records": [
            {column: normalize_value(value) for column, value in record.items()}
            for record in frame.to_dict(orient="records")
        ],
        "columns": build_column_metadata(frame),
        "preview": dataframe_preview(frame),
        "summary": summary,
    }


def snapshot_to_dataframe(snapshot: dict | None) -> pd.DataFrame:
    """Convert a stored snapshot back into a DataFrame.

    Rebuilds the frame from `records` and restores column dtypes from the stored
    `columns[*].data_type` metadata so datetime/numeric columns don't degrade to
    `object` after a JSON round-trip (JSON has no native datetime/numeric types).
    """
    if not snapshot:
        return pd.DataFrame()

    records = snapshot.get("records") or []
    columns_meta = snapshot.get("columns") or []

    if not records:
        column_names = [str(column.get("name")) for column in columns_meta if column.get("name")]
        return pd.DataFrame(columns=column_names)

    frame = pd.DataFrame(records)

    for column in columns_meta:
        name = column.get("name")
        dtype = str(column.get("data_type") or "")
        if not name or name not in frame.columns or not dtype:
            continue
        series = frame[name]
        try:
            if dtype.startswith("datetime64"):
                frame[name] = pd.to_datetime(series, errors="coerce")
            elif dtype.startswith(("int", "float")) and not pd.api.types.is_numeric_dtype(series):
                frame[name] = pd.to_numeric(series, errors="coerce")
            elif dtype == "bool" and not pd.api.types.is_bool_dtype(series):
                frame[name] = series.astype("boolean")
        except Exception:
            continue

    return frame


def snapshot_to_export_bytes(
    snapshot: dict,
    *,
    export_format: Literal["csv", "xlsx", "json"],
) -> tuple[bytes, str, str]:
    """Convert a snapshot into a downloadable file payload.

    Returns:
        (bytes, media_type, file_extension)
    """

    frame = snapshot_to_dataframe(snapshot)

    if export_format == "json":
        records = snapshot.get("records")
        if not isinstance(records, list):
            records = frame.to_dict(orient="records")

        payload = json.dumps(records, ensure_ascii=False, default=str)
        return payload.encode("utf-8"), "application/json", "json"

    if export_format == "csv":
        csv_text = frame.to_csv(index=False)
        return csv_text.encode("utf-8"), "text/csv", "csv"

    if export_format == "xlsx":
        buffer = BytesIO()
        # Pandas will use openpyxl (already in requirements) for .xlsx.
        frame.to_excel(buffer, index=False, sheet_name="data")
        return buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"

    # Should be unreachable due to typing, but kept as a safe guardrail.
    raise ValueError(f"Unsupported export format: {export_format}")
