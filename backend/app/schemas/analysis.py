from __future__ import annotations

from typing import Any

from pydantic import BaseModel

# Shared type alias used by dataset-level endpoints that accept an in-memory snapshot.
_Snapshot = dict | None


class AnalyzeStatsRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None


class TopValue(BaseModel):
    value: Any
    count: int


class ColumnStat(BaseModel):
    name: str
    dtype: str  # "numeric" | "text" | "datetime" | "boolean"
    count: int
    missing: int
    missing_pct: float
    unique: int
    top_values: list[TopValue]
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    min: float | None = None
    max: float | None = None
    q25: float | None = None
    q75: float | None = None


class AnalyzeStatsResponse(BaseModel):
    column_stats: list[ColumnStat]
    row_count: int
    col_count: int


class GroupByRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None
    group_by: str
    aggregate_column: str
    aggregate_func: str  # "sum" | "count" | "mean" | "min" | "max"


class GroupResult(BaseModel):
    group: str
    value: float


class GroupByResponse(BaseModel):
    group_by: str
    aggregate_column: str
    aggregate_func: str
    results: list[GroupResult]


# ── Trend Analysis ────────────────────────────────────────────────────────────

class TrendRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None
    time_column: str | None = None


class ChartPoint(BaseModel):
    x: float
    y: float


class ColumnTrendResult(BaseModel):
    column: str
    direction: str  # "increasing" | "decreasing" | "stable" | "volatile"
    slope: float
    r_squared: float
    min: float
    max: float
    mean: float
    count: int
    chart_points: list[ChartPoint]
    trend_line: list[ChartPoint]
    x_labels: list[str] | None = None  # date strings per chart point when time_column is used


class TrendResponse(BaseModel):
    columns: list[ColumnTrendResult]
    time_column: str | None = None  # which column was used as time axis, or None


# ── Anomaly Detection ─────────────────────────────────────────────────────────

class AnomalyRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None


class ColumnAnomalyResult(BaseModel):
    column: str
    outlier_count: int
    total_count: int
    outlier_pct: float
    lower_fence: float
    upper_fence: float
    sample_outliers: list[Any]


class AnomalyResponse(BaseModel):
    total_flagged_rows: int
    columns_analyzed: int
    columns: list[ColumnAnomalyResult]


# ── Dataset-level request schemas (dataset_id comes from URL path) ────────────

class DatasetTrendRequest(BaseModel):
    """Request body for POST /dataset/{dataset_id}/trend."""
    time_column: str | None = None
    data_snapshot: dict | None = None


class DatasetPredictRequest(BaseModel):
    """Request body for POST /dataset/{dataset_id}/predict."""
    target_column: str
    input_column: str | None = None  # kept for compat; ignored when time_column is set
    future_steps: int = 5
    time_column: str | None = None
    data_snapshot: dict | None = None


# ── Prediction ────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None
    input_column: str
    target_column: str
    future_steps: int = 5
    time_column: str | None = None  # if provided, use as time axis instead of row index


class PredictPoint(BaseModel):
    step: int
    predicted_value: float
    lower_bound: float
    upper_bound: float


class PredictResponse(BaseModel):
    input_column: str
    target_column: str
    future_steps: int
    slope: float
    intercept: float
    r_squared: float
    predictions: list[PredictPoint]
    time_column: str | None = None  # echoes back which time column was used


# ── Correlation Matrix ────────────────────────────────────────────────────────

class CorrelationRequest(BaseModel):
    dataset_id: int
    dataset_version_id: int | None = None


class CorrelationResponse(BaseModel):
    columns: list[str]
    matrix: dict[str, dict[str, float]]
