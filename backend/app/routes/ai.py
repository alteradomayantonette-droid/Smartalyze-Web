"""AI routes.

Endpoints:
- POST /ai/suggest  — proactive cleaning plan based on the detect result
- POST /ai/chat     — follow-up questions about the dataset
"""

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    AISuggestRequest,
    AISuggestResponse,
)
from app.services.ai_service import get_chat_reply, get_suggestion

router = APIRouter(prefix="/ai", tags=["ai"])


def _require_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return authorization.removeprefix("Bearer ").strip()


@router.post("/suggest", response_model=AISuggestResponse)
async def ai_suggest(
    payload: AISuggestRequest,
    authorization: str | None = Header(default=None),
):
    """Return a prioritized AI cleaning plan for the given dataset context."""
    _require_token(authorization)
    try:
        suggestion = await get_suggestion(payload.context)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AISuggestResponse(suggestion=suggestion)


@router.post("/chat", response_model=AIChatResponse)
async def ai_chat(
    payload: AIChatRequest,
    authorization: str | None = Header(default=None),
):
    """Answer a follow-up question about the dataset using its quality context."""
    _require_token(authorization)
    try:
        reply = await get_chat_reply(payload.context, payload.message, payload.history)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return AIChatResponse(reply=reply)
