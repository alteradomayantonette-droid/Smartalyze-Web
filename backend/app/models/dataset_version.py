from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (
        UniqueConstraint("dataset_id", "version_number", name="uq_dataset_versions_dataset_id_version_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    data_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    operation_type: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    dataset = relationship("Dataset", back_populates="versions", foreign_keys=[dataset_id])

    @property
    def row_count(self) -> int | None:
        summary = self.data_snapshot.get("summary") or {}
        return summary.get("row_count")

    @property
    def column_count(self) -> int | None:
        summary = self.data_snapshot.get("summary") or {}
        return summary.get("column_count")

    @property
    def preview_json(self) -> list[dict] | None:
        return self.data_snapshot.get("preview")

    @property
    def columns_json(self) -> list[dict] | None:
        return self.data_snapshot.get("columns")

    @property
    def summary_json(self) -> dict | None:
        return self.data_snapshot.get("summary")

    @property
    def artifact_path(self) -> str:
        return ""

    @property
    def artifact_filename(self) -> str:
        return f"dataset-{self.dataset_id}-v{self.version_number}.json"
