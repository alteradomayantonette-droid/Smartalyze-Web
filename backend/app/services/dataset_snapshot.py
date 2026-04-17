from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd

PREVIEW_ROWS = 10


def normalize_value(value: Any) -> Any:
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
    if not snapshot:
        return pd.DataFrame()

    records = snapshot.get("records") or []
    if records:
        return pd.DataFrame(records)

    columns = snapshot.get("columns") or []
    column_names = [str(column.get("name")) for column in columns if column.get("name")]
    return pd.DataFrame(columns=column_names)
