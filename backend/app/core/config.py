from functools import lru_cache
import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


def _normalize_database_url(database_url: str) -> str:
    database_url = database_url.strip().strip("'").strip('"')
    if database_url.startswith("psql "):
        database_url = database_url.removeprefix("psql ").strip().strip("'").strip('"')
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if "?" in database_url:
        database_url = database_url.split("?", 1)[0]
    return database_url


class Settings:
    project_name: str = "Smartalyze"
    api_prefix: str = ""
    database_url: str = _normalize_database_url(os.getenv("DATABASE_URL", "postgresql+asyncpg://localhost/smartalyze"))
    uploads_dir: Path = Path(os.getenv("SMARTALYZE_UPLOAD_DIR", "storage/uploads"))
    max_upload_size_mb: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "20"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
