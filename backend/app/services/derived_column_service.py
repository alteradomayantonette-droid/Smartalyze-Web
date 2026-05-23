"""Safe expression evaluator for the `derive_column` cleaning operation.

We deliberately avoid Python's built-in `eval()` and instead walk a whitelisted AST
so users cannot reach attribute access, function calls outside the allowed set,
imports, or any side-effect operation. The expression is evaluated per-row against
existing column values to produce a new column.

Allowed:
- Names that resolve to existing column names in the DataFrame
- Numeric / string / boolean / None literals
- BinOp: + - * / // % **
- UnaryOp: + -
- Compare: < <= > >= == != and chained comparisons
- BoolOp: and / or
- Calls to whitelisted functions: abs, round, int, float, str, len, min, max
- IfExp (a if cond else b)
- Subscript on column dicts? No — disallowed.

Disallowed: attribute access, calls to non-whitelisted names, lambda, comprehensions,
imports, assignments, walrus, anything else.
"""

from __future__ import annotations

import ast
from typing import Any

import pandas as pd
from fastapi import HTTPException, status

_ALLOWED_BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.FloorDiv: lambda a, b: a // b,
    ast.Mod: lambda a, b: a % b,
    ast.Pow: lambda a, b: a ** b,
}

_ALLOWED_UNARY = {
    ast.UAdd: lambda v: +v,
    ast.USub: lambda v: -v,
    ast.Not: lambda v: not v,
}

_ALLOWED_COMPARE = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: a < b,
    ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b,
}

_ALLOWED_FUNCS: dict[str, Any] = {
    "abs": abs,
    "round": round,
    "int": int,
    "float": float,
    "str": str,
    "len": len,
    "min": min,
    "max": max,
}


class _ExpressionError(Exception):
    """Raised for any disallowed AST node or unknown name."""


def _evaluate(node: ast.AST, row: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _evaluate(node.body, row)

    if isinstance(node, ast.Constant):
        return node.value

    if isinstance(node, ast.Name):
        name = node.id
        if name in row:
            return row[name]
        if name in _ALLOWED_FUNCS:
            return _ALLOWED_FUNCS[name]
        raise _ExpressionError(f"Unknown column or function: '{name}'")

    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in _ALLOWED_BINOPS:
            raise _ExpressionError(f"Operator {op_type.__name__} is not allowed.")
        left = _evaluate(node.left, row)
        right = _evaluate(node.right, row)
        return _ALLOWED_BINOPS[op_type](left, right)

    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in _ALLOWED_UNARY:
            raise _ExpressionError(f"Unary {op_type.__name__} is not allowed.")
        return _ALLOWED_UNARY[op_type](_evaluate(node.operand, row))

    if isinstance(node, ast.Compare):
        left = _evaluate(node.left, row)
        for op, right_node in zip(node.ops, node.comparators):
            op_type = type(op)
            if op_type not in _ALLOWED_COMPARE:
                raise _ExpressionError(f"Comparison {op_type.__name__} is not allowed.")
            right = _evaluate(right_node, row)
            if not _ALLOWED_COMPARE[op_type](left, right):
                return False
            left = right
        return True

    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for value in node.values:
                result = result and _evaluate(value, row)
                if not result:
                    return False
            return result
        if isinstance(node.op, ast.Or):
            for value in node.values:
                v = _evaluate(value, row)
                if v:
                    return v
            return False
        raise _ExpressionError("Boolean operator not allowed.")

    if isinstance(node, ast.IfExp):
        condition = _evaluate(node.test, row)
        return _evaluate(node.body, row) if condition else _evaluate(node.orelse, row)

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
            raise _ExpressionError("Only whitelisted functions are allowed: " + ", ".join(sorted(_ALLOWED_FUNCS)))
        if node.keywords:
            raise _ExpressionError("Keyword arguments are not supported.")
        args = [_evaluate(arg, row) for arg in node.args]
        try:
            return _ALLOWED_FUNCS[node.func.id](*args)
        except (TypeError, ValueError) as exc:
            raise _ExpressionError(f"{node.func.id}() call failed: {exc}") from exc

    raise _ExpressionError(f"Expression element not allowed: {type(node).__name__}")


def _parse_expression(expression: str) -> ast.AST:
    try:
        return ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid expression syntax: {exc.msg}") from exc


def evaluate_derived_column(
    frame: pd.DataFrame,
    new_column_name: str,
    expression: str,
) -> pd.DataFrame:
    """Add `new_column_name` to `frame` by evaluating `expression` per row.

    Failures inside a row become NaN; the operation never crashes mid-frame.
    Raises HTTPException 400 if the expression itself is unsafe or unparseable.
    """
    name = (new_column_name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="new_column_name is required.")
    if not expression or not expression.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expression is required.")

    tree = _parse_expression(expression)

    # Probe-evaluate on the first non-empty row so unsafe expressions fail fast
    # with a clear 400 instead of being swallowed per row.
    probe_row: dict[str, Any] | None = None
    if not frame.empty:
        probe_row = {col: frame[col].iloc[0] for col in frame.columns}
        try:
            _evaluate(tree, probe_row)
        except _ExpressionError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    values: list[Any] = []
    for _, record in frame.iterrows():
        row_dict = record.to_dict()
        try:
            values.append(_evaluate(tree, row_dict))
        except _ExpressionError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except (TypeError, ZeroDivisionError, ValueError):
            values.append(None)

    frame[name] = values
    return frame


def preview_derived_column(
    frame: pd.DataFrame,
    expression: str,
    sample_size: int = 3,
) -> list[Any]:
    """Evaluate `expression` on up to `sample_size` rows. Used by the UI preview."""
    if not expression or not expression.strip():
        return []
    tree = _parse_expression(expression)
    out: list[Any] = []
    for _, record in frame.head(sample_size).iterrows():
        row_dict = record.to_dict()
        try:
            value = _evaluate(tree, row_dict)
        except _ExpressionError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except (TypeError, ZeroDivisionError, ValueError) as exc:
            value = f"<error: {exc}>"
        out.append(value)
    return out
