"""Smartalyze FastAPI application entrypoint.

High-level structure ("layers"):
- app/routes/*: HTTP endpoints (FastAPI routers). Very thin; validates auth and calls services.
- app/schemas/*: Pydantic models that define request/response contracts.
- app/services/*: business logic + DB operations (create/list/update datasets, cleaning analysis, auth).
- app/models/*: SQLAlchemy ORM models (tables + relationships).
- app/db/*: engine/session wiring.

This file wires middleware + routers and (for local/dev convenience) creates tables on startup.
"""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine
from app.routes.analysis import router as analysis_router
from app.routes.cleaning import router as cleaning_router
from app.routes.auth import router as auth_router
from app.routes.datasets import router as datasets_router
from app.services.ocr_service import prewarm_ocr

app = FastAPI(title="Smartalyze API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # Allowed origins are read from CORS_ALLOWED_ORIGINS (comma-separated).
    # Defaults to localhost:3000 for local dev — set the env var before deploying.
    allow_origins=get_settings().cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Route registration: each router owns a feature area.
app.include_router(datasets_router)
app.include_router(cleaning_router)
app.include_router(analysis_router)
app.include_router(auth_router)


@app.on_event("startup")
async def on_startup() -> None:
    """Create tables on startup (development convenience).

If you later add Alembic migrations, this should typically be removed in production.
    """
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, prewarm_ocr)


@app.get("/")
def root():
    """Lightweight health check endpoint."""
    return {"message": "Smartalyze API is running"}