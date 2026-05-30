from __future__ import annotations

from typing import Any
from pydantic import BaseModel


class AIContext(BaseModel):
    dataset_name: str
    column_types: dict[str, str] = {}
    missing_values: dict[str, int] = {}
    duplicates: int = 0
    issues: list[dict[str, Any]] = []
    pattern_suggestions: list[dict[str, Any]] = []
    outliers: list[dict[str, Any]] = []


class AISuggestRequest(BaseModel):
    context: AIContext


class AISuggestResponse(BaseModel):
    suggestion: str


class AIChatMessage(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    context: AIContext
    message: str
    history: list[AIChatMessage] = []


class AIChatResponse(BaseModel):
    reply: str
