"""Database session wiring.

- `engine` is a global async SQLAlchemy engine.
- `AsyncSessionLocal` is a session factory.
- `get_db()` is a FastAPI dependency that yields an AsyncSession per request.

Most route handlers accept `db: AsyncSession = Depends(get_db)` and pass it down into
service functions.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, pool_pre_ping=True, connect_args={"ssl": True})

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db():
    """FastAPI dependency that yields a DB session and always closes it."""
    db = AsyncSessionLocal()
    try:
        yield db
    finally:
        await db.close()
