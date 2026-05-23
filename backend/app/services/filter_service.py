"""Filter service.

Translate a list of FilterPredicate items into a pandas boolean mask and return
the matching rows in pagination-friendly form.

We never `eval` user input — the operator is a whitelisted Literal and the value
is coerced to the column's dtype where possible.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import HTTPException, status

from app.schemas.filter import FilterPredicate, FilterResponse
from app.services.dataset_snapshot import normalize_value


def _coerce_value(series: pd.Series, value: Any) -> Any:
    """Best-effort coercion of a user-supplied value to the column's dtype."""
    if value is None:
        return value

    if pd.api.types.is_numeric_dtype(series):
        try:
            return float(value)
        except (TypeError, ValueError):
            return value
    if pd.api.types.is_datetime64_any_dtype(series):
        try:
            return pd.to_datetime(value)
        except (TypeError, ValueError):
            return value
    if pd.api.types.is_bool_dtype(series):
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"true", "1", "yes", "y"}:
            return True
        if text in {"false", "0", "no", "n"}:
            return False
        return value
    return value


def _apply_predicate(frame: pd.DataFrame, predicate: FilterPredicate) -> pd.Series:
    if predicate.column not in frame.columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown column: {predicate.column}",
        )

    series = frame[predicate.column]
    op = predicate.op

    if op == "is_null":
        return series.isna()
    if op == "not_null":
        return series.notna()

    if op == "in":
        values = [_coerce_value(series, v) for v in (predicate.values or [])]
        if not values:
            return pd.Series(False, index=frame.index)
        return series.isin(values)

    if op == "between":
        lo = _coerce_value(series, predicate.lower)
        hi = _coerce_value(series, predicate.upper)
        if lo is None or hi is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="'between' requires both `lower` and `upper`.",
            )
        return series.between(lo, hi, inclusive="both")

    if op in {"contains", "starts_with"}:
        if predicate.value is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{op}' requires a value.",
            )
        as_str = series.astype("string")
        needle = str(predicate.value)
        if op == "contains":
            return as_str.str.contains(needle, case=predicate.case_sensitive, na=False, regex=False)
        return as_str.str.startswith(needle, na=False) if predicate.case_sensitive else as_str.str.lower().str.startswith(needle.lower(), na=False)

    value = _coerce_value(series, predicate.value)
    if op == "eq":
        return series == value
    if op == "neq":
        return series != value
    if op == "gt":
        return series > value
    if op == "gte":
        return series >= value
    if op == "lt":
        return series < value
    if op == "lte":
        return series <= value

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported filter operator: {op}",
    )


def filter_rows(
    frame: pd.DataFrame,
    predicates: list[FilterPredicate],
    combine: str = "and",
    offset: int = 0,
    limit: int = 50,
) -> FilterResponse:
    """Apply a list of predicates and return paginated matching rows."""
    total_rows = int(frame.shape[0])

    if not predicates:
        mask = pd.Series(True, index=frame.index)
    else:
        masks = [_apply_predicate(frame, p) for p in predicates]
        mask = masks[0]
        for next_mask in masks[1:]:
            mask = (mask | next_mask) if combine == "or" else (mask & next_mask)

    filtered = frame[mask]
    total_matched = int(filtered.shape[0])

    offset = max(0, int(offset))
    limit = max(1, min(int(limit), 500))
    sliced = filtered.iloc[offset : offset + limit]

    rows = [
        {column: normalize_value(value) for column, value in record.items()}
        for record in sliced.to_dict(orient="records")
    ]

    return FilterResponse(
        rows=rows,
        total_matched=total_matched,
        total_rows=total_rows,
        offset=offset,
        limit=limit,
    )
