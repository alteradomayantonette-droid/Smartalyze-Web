from __future__ import annotations

import pandas as pd

from app.schemas.cleaning import PatternImputationGroup, PatternImputationResult

_MIN_CONFIDENCE = 0.7
_LOW_SAMPLE_THRESHOLD = 5


def _is_categorical(series: pd.Series) -> bool:
    """True if the series looks like a categorical/text column."""
    if pd.api.types.is_bool_dtype(series) or pd.api.types.is_numeric_dtype(series):
        return False
    if pd.api.types.is_datetime64_any_dtype(series):
        return False
    return series.dtype == object


def _analyze_pair(
    df: pd.DataFrame,
    key_col: str,
    target_col: str,
) -> PatternImputationResult | None:
    """
    Analyse the relationship between a categorical key column and a numeric
    target column that has missing values.  Returns None when the pattern is
    too weak (weighted confidence < threshold).
    """
    key_series = df[key_col].dropna()
    target_series = df[target_col]

    groups: list[PatternImputationGroup] = []
    low_sample_groups: list[str] = []
    confidence_sum = 0.0
    confidence_weight = 0

    for key_value, group_df in df.groupby(key_col, dropna=True):
        known = group_df[target_col].dropna()
        missing_mask = group_df[target_col].isna()
        fillable_count = int(missing_mask.sum())

        if len(known) == 0:
            continue

        # Modal fill value for this group
        mode_series = known.mode()
        fill_value = mode_series.iloc[0] if len(mode_series) > 0 else None

        support_count = int(len(known))
        total_in_group = support_count + fillable_count
        confidence = support_count / total_in_group if total_in_group > 0 else 0.0

        key_str = str(key_value)
        if support_count < _LOW_SAMPLE_THRESHOLD:
            low_sample_groups.append(key_str)

        # Normalise fill_value for serialisation
        if fill_value is not None:
            try:
                fill_serialised: str | float | None = float(fill_value)
            except (TypeError, ValueError):
                fill_serialised = str(fill_value)
        else:
            fill_serialised = None

        groups.append(
            PatternImputationGroup(
                key_value=key_str,
                fill_value=fill_serialised,
                confidence=round(confidence, 4),
                support_count=support_count,
                fillable_count=fillable_count,
            )
        )
        confidence_sum += confidence
        confidence_weight += 1

    if confidence_weight == 0:
        return None

    weighted_confidence = round(confidence_sum / confidence_weight, 4)
    if weighted_confidence < _MIN_CONFIDENCE:
        return None

    return PatternImputationResult(
        target_column=target_col,
        key_column=key_col,
        weighted_confidence=weighted_confidence,
        groups=groups,
        low_sample_groups=low_sample_groups,
    )


def find_pattern_suggestions(df: pd.DataFrame, missing_cols: list[str]) -> list[PatternImputationResult]:
    """
    For each numeric column with missing values, find categorical columns whose
    groups predict the missing values with high confidence.
    """
    if df.empty or not missing_cols:
        return []

    categorical_cols = [c for c in df.columns if _is_categorical(df[c]) and df[c].nunique(dropna=True) <= 50]
    numeric_missing = [
        c for c in missing_cols
        if c in df.columns and pd.api.types.is_numeric_dtype(df[c])
    ]

    if not categorical_cols or not numeric_missing:
        return []

    results: list[PatternImputationResult] = []
    seen: set[str] = set()

    for target_col in numeric_missing:
        for key_col in categorical_cols:
            if key_col == target_col:
                continue
            pair_key = f"{key_col}→{target_col}"
            if pair_key in seen:
                continue
            seen.add(pair_key)

            result = _analyze_pair(df, key_col, target_col)
            if result is not None:
                results.append(result)

    return results


def apply_pattern_fill(df: pd.DataFrame, key_col: str, target_col: str) -> pd.DataFrame:
    """
    Fill missing values in target_col using the modal value per group in key_col.
    """
    df = df.copy()
    for key_value, group_idx in df.groupby(key_col, dropna=True).groups.items():
        group = df.loc[group_idx, target_col]
        known = group.dropna()
        if known.empty:
            continue
        fill_val = known.mode().iloc[0]
        missing_in_group = df.loc[group_idx, target_col].isna()
        df.loc[group_idx[missing_in_group], target_col] = fill_val
    return df
