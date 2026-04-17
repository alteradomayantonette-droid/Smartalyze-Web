from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

#This is the current cleaning operations we can add more features here later LOLLLLLLsss
CleaningOperationType = Literal[
    "fill_mean",
    "fill_median",
    "fill_mode",
    "drop_rows",
    "remove_all_duplicates",
    "convert_column_type",
    "trim_whitespace",
    "lowercase_column",
]

CleaningTargetType = Literal["numeric", "string", "datetime", "categorical", "boolean"]


class CleaningIssue(BaseModel):
    kind: str
    severity: Literal["info", "warning", "error"] = "warning"
    column: str | None = None
    message: str
    suggestion: str | None = None
    details: dict[str, Any] | None = None


class CleaningOperation(BaseModel):
    operation_type: CleaningOperationType
    columns: list[str] = Field(default_factory=list)
    column: str | None = None
    target_type: CleaningTargetType | None = None
    drop_all_missing: bool = True
    errors: Literal["raise", "coerce", "ignore"] = "coerce"


class CleanDetectRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None


class CleanDetectResponse(BaseModel):
    dataset_id: int
    dataset_version_id: int
    missing_values: dict[str, int]
    duplicates: int
    column_types: dict[str, str]
    issues: list[CleaningIssue]


class CleanApplyRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None
    cleaning_operations: list[CleaningOperation] = Field(default_factory=list)

#This is the results output dataset scheme
class CleanApplyResponse(BaseModel):
    dataset_id: int
    dataset_version_id: int
    source_version_id: int
    operations_applied: list[CleaningOperation]
    missing_values: dict[str, int]
    duplicates: int
    column_types: dict[str, str]
    issues: list[CleaningIssue]
    preview: list[dict]
    summary: dict[str, Any]
    data_snapshot: dict[str, Any]
