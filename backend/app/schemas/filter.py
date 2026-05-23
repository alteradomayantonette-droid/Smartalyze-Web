"""Filter API schemas.

These power the row-filtering endpoint used by the dataset workspace.
Predicates are restricted to a whitelisted set of operators; the service layer
translates them into pandas boolean masks (never eval).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

FilterOp = Literal[
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "starts_with",
    "is_null",
    "not_null",
    "in",
    "between",
]


class FilterPredicate(BaseModel):
    column: str
    op: FilterOp
    value: Any | None = None
    values: list[Any] | None = None  # for "in"
    lower: Any | None = None         # for "between"
    upper: Any | None = None         # for "between"
    case_sensitive: bool = False     # only relevant for contains/starts_with


class FilterRequest(BaseModel):
    """Request body for POST /dataset/{id}/filter."""
    predicates: list[FilterPredicate] = []
    combine: Literal["and", "or"] = "and"
    offset: int = 0
    limit: int = 50
    data_snapshot: dict | None = None


class FilterResponse(BaseModel):
    rows: list[dict]
    total_matched: int
    total_rows: int
    offset: int
    limit: int
