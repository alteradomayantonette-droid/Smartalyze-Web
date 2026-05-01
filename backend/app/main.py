"""Smartalyze FastAPI application entrypoint.

High-level structure ("layers"):
- app/routes/*: HTTP endpoints (FastAPI routers). Very thin; validates auth and calls services.
- app/schemas/*: Pydantic models that define request/response contracts.
- app/services/*: business logic + DB operations (create/list/update datasets, cleaning analysis, auth).
- app/models/*: SQLAlchemy ORM models (tables + relationships).
- app/db/*: engine/session wiring.

This file wires middleware + routers and (for local/dev convenience) creates tables on startup.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401
from app.db.base import Base
from app.db.session import engine
from app.routes.analysis import router as analysis_router
from app.routes.cleaning import router as cleaning_router
from app.routes.auth import router as auth_router
from app.routes.datasets import router as datasets_router

app = FastAPI(title="Smartalyze API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # CORS is configured for local dev (Next.js running on :3000).
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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


@app.get("/")
def root():
    """Lightweight health check endpoint."""
    return {"message": "Smartalyze API is running"}