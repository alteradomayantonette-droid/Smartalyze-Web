"""Analysis routes.

Endpoints:
- POST /analysis/stats: compute per-column statistics for a dataset version
- POST /analysis/group: group by one column and aggregate another
"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.analysis import (
    AnomalyRequest,
    AnomalyResponse,
    AnalyzeStatsRequest,
    AnalyzeStatsResponse,
    CorrelationRequest,
    CorrelationResponse,
    GroupByRequest,
    GroupByResponse,
    PredictRequest,
    PredictResponse,
    TrendRequest,
    TrendResponse,
)
from app.services.analysis_service import analyze_stats, anomaly_detection, group_dataset, predict_column, trend_analysis
from app.services.correlation_service import compute_correlation
from app.services.auth_service import get_user_by_token
from app.services.dataset_service import get_owned_dataset

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _get_current_token(authorization: str | None) -> str:
    """Extract a Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")

    return authorization.removeprefix("Bearer ").strip()


@router.post("/stats", response_model=AnalyzeStatsResponse)
async def get_stats(
    payload: AnalyzeStatsRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return per-column statistics for a dataset (or a specific version)."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return analyze_stats(dataset, payload.dataset_version_id)


@router.post("/group", response_model=GroupByResponse)
async def group_by(
    payload: GroupByRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Group a dataset by one column and aggregate another column."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return group_dataset(
        dataset,
        payload.group_by,
        payload.aggregate_column,
        payload.aggregate_func,
        payload.dataset_version_id,
    )


@router.post("/trend", response_model=TrendResponse)
async def trend(
    payload: TrendRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Run linear regression on all numeric columns and return trend results."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return trend_analysis(dataset, payload.dataset_version_id, time_column=payload.time_column)


@router.post("/anomaly", response_model=AnomalyResponse)
async def anomaly(
    payload: AnomalyRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Detect outliers in numeric columns using the IQR method."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return anomaly_detection(dataset, payload.dataset_version_id)


@router.post("/correlation", response_model=CorrelationResponse)
async def correlation(
    payload: CorrelationRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Compute Pearson correlation matrix for all numeric columns."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return compute_correlation(dataset, payload.dataset_version_id)


@router.post("/predict", response_model=PredictResponse)
async def predict(
    payload: PredictRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Predict future values for a numeric column using linear regression."""
    token = _get_current_token(authorization)
    owner = await get_user_by_token(db, token)
    dataset = await get_owned_dataset(db, payload.dataset_id, owner)
    return predict_column(dataset, payload.input_column, payload.target_column, payload.future_steps, payload.dataset_version_id, time_column=payload.time_column)
