from __future__ import annotations

import math

import numpy as np
import pandas as pd
from fastapi import HTTPException, status

from app.models.dataset import Dataset
from app.models.dataset_version import DatasetVersion
from sklearn.linear_model import LinearRegression

from app.schemas.analysis import (
    AnomalyResponse,
    AnalyzeStatsResponse,
    ChartPoint,
    ColumnAnomalyResult,
    ColumnStat,
    ColumnTrendResult,
    GroupByResponse,
    GroupResult,
    PredictPoint,
    PredictResponse,
    TopValue,
    TrendResponse,
)
from app.services.dataset_snapshot import snapshot_to_dataframe

SUPPORTED_AGG_FUNCS = {"sum", "count", "mean", "min", "max"}


def _get_version(dataset: Dataset, version_id: int | None) -> DatasetVersion:
    """Return the requested version (or current) from the already-loaded dataset."""
    if version_id is not None:
        version = next((v for v in (dataset.versions or []) if v.id == version_id), None)
        if version is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset version not found.")
        return version

    if dataset.current_version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset has no current version.")
    return dataset.current_version


def _safe_float(value) -> float | None:
    """Convert a value to float, returning None if it is NaN/infinite."""
    try:
        result = float(value)
        return None if math.isnan(result) or math.isinf(result) else round(result, 4)
    except (TypeError, ValueError):
        return None


def analyze_stats(dataset: Dataset, version_id: int | None = None) -> AnalyzeStatsResponse:
    """Compute per-column statistics for a dataset version."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    column_stats: list[ColumnStat] = []
    for col in df.columns:
        series = df[col]
        total = len(series)
        count = int(series.count())
        missing = int(series.isna().sum())
        missing_pct = round(missing / total * 100, 2) if total > 0 else 0.0
        unique = int(series.nunique(dropna=True))

        top_values = [
            TopValue(value=v, count=int(c))
            for v, c in series.value_counts(dropna=True).head(5).items()
        ]

        if pd.api.types.is_bool_dtype(series):
            dtype = "boolean"
            mean = median = std = min_val = max_val = q25 = q75 = None
        elif pd.api.types.is_datetime64_any_dtype(series):
            dtype = "datetime"
            mean = median = std = min_val = max_val = q25 = q75 = None
        elif pd.api.types.is_numeric_dtype(series):
            dtype = "numeric"
            numeric = series.dropna()
            mean = _safe_float(numeric.mean()) if len(numeric) > 0 else None
            median = _safe_float(numeric.median()) if len(numeric) > 0 else None
            std = _safe_float(numeric.std()) if len(numeric) > 1 else None
            min_val = _safe_float(numeric.min()) if len(numeric) > 0 else None
            max_val = _safe_float(numeric.max()) if len(numeric) > 0 else None
            q25 = _safe_float(numeric.quantile(0.25)) if len(numeric) > 0 else None
            q75 = _safe_float(numeric.quantile(0.75)) if len(numeric) > 0 else None
        else:
            dtype = "text"
            mean = median = std = min_val = max_val = q25 = q75 = None

        column_stats.append(
            ColumnStat(
                name=col,
                dtype=dtype,
                count=count,
                missing=missing,
                missing_pct=missing_pct,
                unique=unique,
                top_values=top_values,
                mean=mean,
                median=median,
                std=std,
                min=min_val,
                max=max_val,
                q25=q25,
                q75=q75,
            )
        )

    return AnalyzeStatsResponse(
        column_stats=column_stats,
        row_count=len(df),
        col_count=len(df.columns),
    )


def trend_analysis(dataset: Dataset, version_id: int | None = None) -> TrendResponse:
    """Run linear regression on all numeric columns and return trend results."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    results: list[ColumnTrendResult] = []

    for col in numeric_cols:
        series = df[col].dropna().reset_index(drop=True)
        if len(series) < 2:
            continue

        values = series.to_numpy(dtype=float)
        x = np.arange(len(values), dtype=float)

        slope, intercept = np.polyfit(x, values, 1)

        y_pred = slope * x + intercept
        ss_res = float(np.sum((values - y_pred) ** 2))
        ss_tot = float(np.sum((values - np.mean(values)) ** 2))
        r_squared = round(1.0 - ss_res / ss_tot, 4) if ss_tot > 1e-10 else 0.0

        col_mean = float(np.mean(values))
        if r_squared < 0.1:
            direction = "volatile"
        elif abs(slope) / (abs(col_mean) + 1e-10) < 0.001:
            direction = "stable"
        elif slope > 0:
            direction = "increasing"
        else:
            direction = "decreasing"

        chart_points = [ChartPoint(x=float(i), y=round(float(v), 4)) for i, v in enumerate(values)]
        n = len(values)
        trend_line = [
            ChartPoint(x=0.0, y=round(float(intercept), 4)),
            ChartPoint(x=float(n - 1), y=round(float(slope * (n - 1) + intercept), 4)),
        ]

        results.append(
            ColumnTrendResult(
                column=col,
                direction=direction,
                slope=round(float(slope), 6),
                r_squared=r_squared,
                min=round(float(values.min()), 4),
                max=round(float(values.max()), 4),
                mean=round(col_mean, 4),
                count=len(values),
                chart_points=chart_points,
                trend_line=trend_line,
            )
        )

    return TrendResponse(columns=results)


def anomaly_detection(dataset: Dataset, version_id: int | None = None) -> AnomalyResponse:
    """Detect outliers in all numeric columns using the IQR method."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    col_results: list[ColumnAnomalyResult] = []
    all_outlier_indices: set[int] = set()

    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 4:
            continue

        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1

        lower_fence = q1 - 1.5 * iqr
        upper_fence = q3 + 1.5 * iqr

        outlier_mask = (df[col] < lower_fence) | (df[col] > upper_fence)
        outlier_indices = set(df.index[outlier_mask & df[col].notna()].tolist())
        all_outlier_indices |= outlier_indices

        outlier_values = df.loc[list(outlier_indices), col].dropna().head(5).tolist()
        sample = [round(float(v), 4) if isinstance(v, float) else v for v in outlier_values]

        total = int(series.count())
        count = len(outlier_indices)
        pct = round(count / total * 100, 2) if total > 0 else 0.0

        col_results.append(
            ColumnAnomalyResult(
                column=col,
                outlier_count=count,
                total_count=total,
                outlier_pct=pct,
                lower_fence=round(lower_fence, 4),
                upper_fence=round(upper_fence, 4),
                sample_outliers=sample,
            )
        )

    col_results.sort(key=lambda r: r.outlier_count, reverse=True)

    return AnomalyResponse(
        total_flagged_rows=len(all_outlier_indices),
        columns_analyzed=len(col_results),
        columns=col_results,
    )


def predict_column(
    dataset: Dataset,
    input_column: str,
    target_column: str,
    future_steps: int,
    version_id: int | None = None,
) -> PredictResponse:
    """Predict future values for a numeric target column using linear regression."""
    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    if input_column not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{input_column}' not found.")
    if target_column not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{target_column}' not found.")

    y_series = pd.to_numeric(df[target_column], errors="coerce").dropna()
    if len(y_series) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Column '{target_column}' has too few numeric values to predict (need at least 2).",
        )

    x = np.arange(len(y_series)).reshape(-1, 1)
    y = y_series.to_numpy(dtype=float)

    model = LinearRegression().fit(x, y)
    slope = float(model.coef_[0])
    intercept = float(model.intercept_)

    y_pred_train = model.predict(x)
    ss_res = float(np.sum((y - y_pred_train) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r_squared = round(1.0 - ss_res / ss_tot, 4) if ss_tot > 1e-10 else 0.0
    std_error = float(np.sqrt(ss_res / max(len(y) - 2, 1)))

    n = len(y_series)
    predictions = [
        PredictPoint(
            step=i,
            predicted_value=round(float(model.predict([[n + i - 1]])[0]), 4),
            lower_bound=round(float(model.predict([[n + i - 1]])[0]) - std_error, 4),
            upper_bound=round(float(model.predict([[n + i - 1]])[0]) + std_error, 4),
        )
        for i in range(1, future_steps + 1)
    ]

    return PredictResponse(
        input_column=input_column,
        target_column=target_column,
        future_steps=future_steps,
        slope=round(slope, 6),
        intercept=round(intercept, 4),
        r_squared=r_squared,
        predictions=predictions,
    )


def group_dataset(
    dataset: Dataset,
    group_by: str,
    aggregate_column: str,
    aggregate_func: str,
    version_id: int | None = None,
) -> GroupByResponse:
    """Group a dataset by one column and aggregate another."""
    if aggregate_func not in SUPPORTED_AGG_FUNCS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported aggregate function '{aggregate_func}'. Use: {', '.join(sorted(SUPPORTED_AGG_FUNCS))}.",
        )

    version = _get_version(dataset, version_id)
    df = snapshot_to_dataframe(version.data_snapshot)

    if group_by not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{group_by}' not found.")
    if aggregate_column not in df.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Column '{aggregate_column}' not found.")

    try:
        grouped = df.groupby(group_by, dropna=False)[aggregate_column]
        if aggregate_func == "sum":
            result_series = grouped.sum(numeric_only=True)
        elif aggregate_func == "count":
            result_series = grouped.count()
        elif aggregate_func == "mean":
            result_series = grouped.mean(numeric_only=True)
        elif aggregate_func == "min":
            result_series = grouped.min(numeric_only=True)
        elif aggregate_func == "max":
            result_series = grouped.max(numeric_only=True)
        else:
            result_series = grouped.count()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not aggregate column '{aggregate_column}' with '{aggregate_func}': {exc}",
        ) from exc

    results = [
        GroupResult(
            group=str(k) if k is not None else "(blank)",
            value=_safe_float(v) or 0.0,
        )
        for k, v in result_series.items()
    ]
    results.sort(key=lambda r: r.value, reverse=True)

    return GroupByResponse(
        group_by=group_by,
        aggregate_column=aggregate_column,
        aggregate_func=aggregate_func,
        results=results,
    )
