"""Verification tests for quality detection + the new cleaning operations.

Runnable two ways:
- with pytest (if installed):   pytest tests/test_quality_detection.py
- standalone (no deps):         python -m tests.test_quality_detection   (from the backend/ dir)
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.cleaning import CleaningOperation
from app.services.cleaning_service import _apply_operation, _order_operations, apply_cleaning_operations
from app.services.quality_detection_service import (
    analyze_quality,
    detect_categorical_variants,
    detect_format_inconsistency,
    detect_outliers,
    detect_pseudo_nulls,
)


def test_categorical_variants_collapses_gender():
    series = pd.Series(["Male", "male", "M", "Female", "F", "Female", "Male", "Male"])
    result = detect_categorical_variants(series, "gender")
    assert result is not None, "expected a suggestion for mixed gender labels"
    canon = {g.canonical: set(g.variants) for g in result.groups}
    # Male is most frequent -> canonical; M and male are its variants.
    assert "Male" in canon and {"M", "male"}.issubset(canon["Male"]), canon
    # Female group with F as a variant.
    assert "Female" in canon and "F" in canon["Female"], canon


def test_categorical_variants_skips_high_cardinality_names():
    names = pd.Series([f"person_{i}" for i in range(60)])
    assert detect_categorical_variants(names, "name") is None


def test_categorical_variants_ambiguous_abbrev_not_merged():
    # "M" is a prefix of both "Male" and "Married" -> must NOT auto-merge.
    series = pd.Series(["Male", "Married", "M", "Male", "Married"])
    result = detect_categorical_variants(series, "status")
    if result is not None:
        for g in result.groups:
            members = {g.canonical, *g.variants}
            assert not ({"Male", "Married"} <= members), "Male and Married must not be merged"


def test_pseudo_nulls_detected_in_name_column():
    series = pd.Series(["juan", "angel", "NA", "Not applicable", "joaqin", "-"])
    result = detect_pseudo_nulls(series, "name")
    assert result is not None
    assert result.total == 3, result.tokens
    assert "na" in result.tokens and "not applicable" in result.tokens


def test_format_inconsistency_mixed_dates():
    series = pd.Series(["July 21 2005", "07/21/2005", "2005-07-21", "08/01/2005"])
    result = detect_format_inconsistency(series, "dob")
    assert result is not None
    assert len(result["formats"]) >= 2, result


def test_format_inconsistency_single_format_ok():
    series = pd.Series(["2005-07-21", "2006-01-02", "2007-03-04"])
    assert detect_format_inconsistency(series, "dob") is None


def test_outliers_flag_extreme_value():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    results = detect_outliers(frame)
    assert any(o.column == "amount" and o.outlier_count >= 1 for o in results), results


def test_op_standardize_categories():
    frame = pd.DataFrame({"gender": ["M", "male", "Female", "F"]})
    op = CleaningOperation(
        operation_type="standardize_categories",
        column="gender",
        value_mapping={"M": "Male", "male": "Male", "F": "Female"},
    )
    out = _apply_operation(frame.copy(), op)
    assert out["gender"].tolist() == ["Male", "Male", "Female", "Female"]


def test_op_replace_with_missing():
    frame = pd.DataFrame({"name": ["juan", "NA", "Not applicable", "angel"]})
    op = CleaningOperation(operation_type="replace_with_missing", column="name")
    out = _apply_operation(frame.copy(), op)
    assert out["name"].isna().sum() == 2
    assert out["name"].tolist()[0] == "juan" and out["name"].tolist()[3] == "angel"


def test_op_remove_outliers():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    op = CleaningOperation(operation_type="remove_outliers", column="amount")
    out = _apply_operation(frame.copy(), op)
    assert 1000 not in out["amount"].tolist()
    assert len(out) == len(frame) - 1


def test_op_nullify_outliers_blanks_only_outlier_keeps_rows():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    op = CleaningOperation(operation_type="nullify_outliers", column="amount")
    out = _apply_operation(frame.copy(), op)
    assert len(out) == len(frame), "rows must be preserved"
    assert out["amount"].isna().sum() == 1
    assert out["amount"].dropna().tolist() == [10, 11, 12, 13, 12, 11, 10, 9]


def test_order_operations_sorts_bad_queue():
    ops = [
        CleaningOperation(operation_type="fill_median", column="x"),
        CleaningOperation(operation_type="sort_values", column="x"),
        CleaningOperation(operation_type="convert_column_type", column="x", target_type="numeric"),
        CleaningOperation(operation_type="replace_with_missing", column="x"),
        CleaningOperation(operation_type="remove_all_duplicates"),
    ]
    ordered = [o.operation_type for o in _order_operations(ops)]
    assert ordered.index("remove_all_duplicates") < ordered.index("convert_column_type")
    assert ordered.index("convert_column_type") < ordered.index("fill_median")
    assert ordered.index("replace_with_missing") < ordered.index("fill_median")
    assert ordered[-1] == "sort_values"


def test_fill_median_auto_coerces_numeric_string():
    # numbers stored as text — previously raised and failed the whole batch.
    frame = pd.DataFrame({"price": ["10", "20", "30", None, "40"]})
    op = CleaningOperation(operation_type="fill_median", columns=["price"])
    out = _apply_operation(frame.copy(), op)
    assert out["price"].isna().sum() == 0
    assert out["price"].tolist() == [10, 20, 30, 25, 40]


def test_nullify_then_fill_replaces_outlier_with_clean_median():
    frame = pd.DataFrame({"amount": [10, 11, 12, 13, 12, 11, 10, 9, 1000]})
    ops = [
        CleaningOperation(operation_type="fill_median", column="amount"),
        CleaningOperation(operation_type="nullify_outliers", column="amount"),
    ]
    out, _applied, _unparseable = apply_cleaning_operations(frame, ops)
    # Ordering must run nullify before fill, so the 1000 becomes the clean median (11).
    assert len(out) == len(frame)
    assert 1000 not in out["amount"].tolist()
    assert out["amount"].iloc[-1] == 11


def test_analyze_quality_combined():
    frame = pd.DataFrame(
        {
            "gender": ["Male", "male", "M", "Female", "F"],
            "name": ["juan", "angel", "NA", "joaqin", "Not applicable"],
            "dob": ["July 21 2005", "07/21/2005", "2005-07-21", "08/01/2005", "2006-02-02"],
            "amount": [10, 11, 12, 13, 1000],
        }
    )
    findings = analyze_quality(frame)
    kinds = {i.kind for i in findings.issues}
    assert "categorical_variants" in kinds
    assert "pseudo_nulls" in kinds
    assert "format_inconsistency" in kinds
    assert "outliers" in kinds


def _run_all():
    tests = [fn for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    passed = 0
    for fn in tests:
        try:
            fn()
        except AssertionError as exc:
            print(f"FAIL  {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR {fn.__name__}: {type(exc).__name__}: {exc}")
        else:
            passed += 1
            print(f"PASS  {fn.__name__}")
    print(f"\n{passed}/{len(tests)} passed")
    return passed == len(tests)


if __name__ == "__main__":
    sys.exit(0 if _run_all() else 1)
