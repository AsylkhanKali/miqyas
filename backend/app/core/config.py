"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    project_name: str = "MIQYAS"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    secret_key: str = "change-me-in-production"

    # Database
    database_url: str = "postgresql+asyncpg://miqyas:miqyas_dev@localhost:5432/miqyas"
    database_url_sync: str = "postgresql://miqyas:miqyas_dev@localhost:5432/miqyas"

    @field_validator("database_url", mode="before")
    @classmethod
    def fix_async_database_url(cls, v: str) -> str:
        # Railway and other providers supply postgres:// or postgresql:// without async driver
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @field_validator("database_url_sync", mode="before")
    @classmethod
    def fix_sync_database_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Storage
    storage_backend: str = "local"  # "local" or "s3"
    upload_dir: Path = Path("./uploads")
    ifc_storage_dir: Path = Path("./uploads/ifc")
    video_storage_dir: Path = Path("./uploads/video")
    frame_storage_dir: Path = Path("./uploads/frames")
    report_storage_dir: Path = Path("./uploads/reports")

    # AWS / Cloudflare R2 (S3-compatible)
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "auto"          # R2 uses "auto", AWS uses e.g. "us-east-1"
    s3_bucket: str = "miqyas-uploads"
    # For Cloudflare R2: "https://<account_id>.r2.cloudflarestorage.com"
    # Leave blank for standard AWS S3
    s3_endpoint_url: str = ""

    # Procore
    procore_client_id: str = ""
    procore_client_secret: str = ""
    procore_redirect_uri: str = ""

    # Sentry
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.1


@lru_cache
def get_settings() -> Settings:
    return Settings()
