"""Dataset ORM model.

`Dataset` is the user-owned container.

Data is stored as snapshots (see `DatasetVersion.data_snapshot`). `current_version_id`
points at the snapshot that should be treated as "current" in the UI.

Cascade behavior:
- versions/actions are deleted when a dataset is deleted (delete-orphan + FK CASCADE)
- current_version_id is set to NULL if the referenced version is deleted
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Dataset(Base):
    """User-owned dataset container."""
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("dataset_versions.id", use_alter=True, name="fk_datasets_current_version_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="datasets")
    versions = relationship(
        "DatasetVersion",
        back_populates="dataset",
        cascade="all, delete-orphan",
        foreign_keys="DatasetVersion.dataset_id",
    )
    actions = relationship("DatasetAction", back_populates="dataset", cascade="all, delete-orphan")
    current_version = relationship("DatasetVersion", foreign_keys=[current_version_id], post_update=True, uselist=False)

    @property
    def original_filename(self) -> str:
        return self.name

    @property
    def owner_user_id(self) -> int:
        return self.user_id

    @property
    def stored_filename(self) -> str:
        return self.name

    @property
    def file_path(self) -> str:
        return ""

    @property
    def mime_type(self) -> str | None:
        return None

    @property
    def file_format(self) -> str:
        return self.file_type

    @property
    def row_count(self) -> int | None:
        snapshot = self.current_snapshot
        if snapshot is None:
            return None
        summary = snapshot.get("summary") or {}
        return summary.get("row_count")

    @property
    def column_count(self) -> int | None:
        snapshot = self.current_snapshot
        if snapshot is None:
            return None
        summary = snapshot.get("summary") or {}
        return summary.get("column_count")

    @property
    def columns_json(self) -> list[dict] | None:
        snapshot = self.current_snapshot
        if snapshot is None:
            return None
        return snapshot.get("columns")

    @property
    def preview_json(self) -> list[dict] | None:
        snapshot = self.current_snapshot
        if snapshot is None:
            return None
        return snapshot.get("preview")

    @property
    def summary_json(self) -> dict | None:
        snapshot = self.current_snapshot
        if snapshot is None:
            return None
        return snapshot.get("summary")

    @property
    def size_bytes(self) -> int:
        snapshot = self.current_snapshot
        if snapshot is None:
            return 0
        summary = snapshot.get("summary") or {}
        return int(summary.get("size_bytes") or 0)

    @property
    def current_snapshot(self) -> dict | None:
        if self.current_version is None:
            return None
        return self.current_version.data_snapshot
