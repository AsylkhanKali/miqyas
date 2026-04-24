"""
Storage Service — abstract file storage with local and S3/R2 backends.

Usage:
    from app.services.storage import get_storage

    storage = get_storage()
    key = await storage.upload(local_path, "ifc/{project_id}/model.ifc")
    url = await storage.presigned_url(key)            # redirect frontend here
    local = await storage.get_local_path(key, tmp)    # for Celery/ifcopenshell
    await storage.delete(key)

Configure via environment:
    STORAGE_BACKEND=local   — files in UPLOAD_DIR (default, ephemeral on Railway)
    STORAGE_BACKEND=s3      — AWS S3 or Cloudflare R2

For Cloudflare R2 (free tier, recommended for Railway):
    STORAGE_BACKEND=s3
    AWS_ACCESS_KEY_ID=<R2 Access Key ID>
    AWS_SECRET_ACCESS_KEY=<R2 Secret Access Key>
    S3_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
    S3_BUCKET=miqyas-uploads
    AWS_REGION=auto
"""

import logging
import shutil
import tempfile
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class StorageService(ABC):
    """Abstract base for file storage backends."""

    @abstractmethod
    async def upload(self, local_path: Path, key: str) -> str:
        """Upload a local file. Returns the storage key."""
        ...

    @abstractmethod
    async def get_local_path(self, key: str, dest: Path | None = None) -> Path:
        """Return a local filesystem path to the file.

        For local storage this is instant (same file).
        For S3/R2 this downloads to *dest* (or a temp file) and returns that path.
        Caller is responsible for deleting temp files when done.
        """
        ...

    @abstractmethod
    async def presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Return a URL clients can use to download the file.

        Local: returns None (caller should stream via API).
        S3/R2: returns a presigned URL.
        """
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete a file from storage."""
        ...

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a file exists in storage."""
        ...

    def is_local(self) -> bool:
        """Return True if files are on the local filesystem (no temp download needed)."""
        return False

    # ── Legacy aliases (kept for callers that used the old API) ──────────────
    async def url(self, key: str, expires_in: int = 3600) -> str:
        return await self.presigned_url(key, expires_in)

    async def download(self, key: str, dest_path: Path) -> Path:
        return await self.get_local_path(key, dest_path)


class LocalStorage(StorageService):
    """Store files on the local filesystem under upload_dir."""

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or settings.upload_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        return self.base_dir / key

    async def upload(self, local_path: Path, key: str) -> str:
        dest = self._resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != dest.resolve():
            shutil.copy2(local_path, dest)
        logger.debug(f"LocalStorage: stored {key} ({dest.stat().st_size} bytes)")
        return key

    async def get_local_path(self, key: str, dest: Path | None = None) -> Path:
        src = self._resolve(key)
        if not src.exists():
            raise FileNotFoundError(f"File not found in local storage: {key}")
        if dest and src.resolve() != dest.resolve():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            return dest
        return src

    async def presigned_url(self, key: str, expires_in: int = 3600) -> str:
        # Local storage has no URL — callers should check is_local() and stream
        return ""

    async def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.exists():
            path.unlink()
            logger.debug(f"LocalStorage: deleted {key}")

    async def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    def is_local(self) -> bool:
        return True


class S3Storage(StorageService):
    """Store files in AWS S3 or any S3-compatible service (Cloudflare R2, MinIO…)."""

    def __init__(self):
        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 is required for S3/R2 storage: pip install boto3")

        self.bucket = settings.s3_bucket
        kwargs: dict = {
            "region_name": settings.aws_region or "auto",
            "aws_access_key_id": settings.aws_access_key_id or None,
            "aws_secret_access_key": settings.aws_secret_access_key or None,
        }
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url

        self.client = boto3.client("s3", **kwargs)
        endpoint_hint = settings.s3_endpoint_url or "AWS S3"
        logger.info(f"S3Storage: bucket={self.bucket} endpoint={endpoint_hint}")

    def is_local(self) -> bool:
        return False

    async def upload(self, local_path: Path, key: str) -> str:
        self.client.upload_file(str(local_path), self.bucket, key)
        logger.debug(f"S3Storage: uploaded s3://{self.bucket}/{key}")
        return key

    async def get_local_path(self, key: str, dest: Path | None = None) -> Path:
        """Download from S3/R2 to a local file. Creates a temp file if dest is None."""
        if dest is None:
            suffix = Path(key).suffix or ".ifc"
            fd, tmp = tempfile.mkstemp(suffix=suffix)
            import os; os.close(fd)
            dest = Path(tmp)
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest))
        logger.debug(f"S3Storage: downloaded s3://{self.bucket}/{key} → {dest}")
        return dest

    async def presigned_url(self, key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    async def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)
        logger.debug(f"S3Storage: deleted s3://{self.bucket}/{key}")

    async def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False


@lru_cache
def get_storage() -> StorageService:
    """Factory — returns the configured storage backend (cached singleton)."""
    backend = settings.storage_backend
    if backend == "s3":
        logger.info("Using S3/R2 storage backend")
        return S3Storage()
    logger.info("Using local storage backend")
    return LocalStorage()
