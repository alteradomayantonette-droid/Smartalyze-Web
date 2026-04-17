from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class DatasetColumn(BaseModel):
    name: str
    data_type: str
    missing_values: int
    non_null_values: int
    unique_values: int


class DatasetSummary(BaseModel):
    row_count: int
    column_count: int
    missing_cells: int
    duplicate_rows: int


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_user_id: int
    current_version_id: int | None = None
    original_filename: str
    stored_filename: str
    file_path: str
    mime_type: str | None
    file_format: str
    description: str | None
    size_bytes: int
    row_count: int | None
    column_count: int | None
    columns_json: list[dict] | None = None
    preview_json: list[dict] | None = None
    summary_json: dict | None = None
    created_at: datetime


class DatasetVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    dataset_id: int
    version_number: int
    operation_type: str
    artifact_path: str
    artifact_filename: str
    row_count: int | None
    column_count: int | None
    preview_json: list[dict] | None = None
    columns_json: list[dict] | None = None
    summary_json: dict | None = None
    created_at: datetime


class DatasetWorkspaceRead(BaseModel):
    dataset: DatasetRead
    versions: list[DatasetVersionRead]
    warnings: list[dict]
    suggestions: list[dict]


class DatasetUploadResponse(BaseModel):
    message: str
    dataset: DatasetRead


class CreateDatasetVersionRequest(BaseModel):
    operation_type: str = Field(min_length=3, max_length=50)
    replace_current: bool = False
    data_snapshot: dict | None = None
