"""
Storage Service — abstract file storage with local and S3 backends.

Usage:
    from app.services.storage import get_storage

    storage = get_storage()
    await storage.upload(local_path, "ifc/model.ifc")
    url = await storage.url("ifc/model.ifc")
    data = await storage.download("ifc/model.ifc")
    await storage.delete("ifc/model.ifc")

Configure via environment:
    STORAGE_BACKEND=local   (default — files in UPLOAD_DIR)
    STORAGE_BACKEND=s3      (requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET)
"""

import logging
import shutil
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
        """Upload a local file to storage. Returns the storage key."""
        ...

    @abstractmethod
    async def download(self, key: str, dest_path: Path) -> Path:
        """Download a file from storage to a local path."""
        ...

    @abstractmethod
    async def url(self, key: str, expires_in: int = 3600) -> str:
        """Get a URL for the stored file. For local, returns a file path."""
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete a file from storage."""
        ...

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a file exists in storage."""
        ...


class LocalStorage(StorageService):
    """Store files on the local filesystem under UPLOAD_DIR."""

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
        logger.debug(f"LocalStorage: uploaded {key} ({dest.stat().st_size} bytes)")
        return key

    async def download(self, key: str, dest_path: Path) -> Path:
        src = self._resolve(key)
        if not src.exists():
            raise FileNotFoundError(f"File not found in local storage: {key}")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest_path.resolve():
            shutil.copy2(src, dest_path)
        return dest_path

    async def url(self, key: str, expires_in: int = 3600) -> str:
        return str(self._resolve(key))

    async def delete(self, key: str) -> None:
        path = self._resolve(key)
        if path.exists():
            path.unlink()
            logger.debug(f"LocalStorage: deleted {key}")

    async def exists(self, key: str) -> bool:
        return self._resolve(key).exists()


class S3Storage(StorageService):
    """Store files in AWS S3. Requires boto3."""

    def __init__(self):
        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 is required for S3 storage: pip install boto3")

        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )
        logger.info(f"S3Storage: initialized with bucket={self.bucket}, region={settings.aws_region}")

    async def upload(self, local_path: Path, key: str) -> str:
        self.client.upload_file(str(local_path), self.bucket, key)
        logger.debug(f"S3Storage: uploaded {key} to s3://{self.bucket}/{key}")
        return key

    async def download(self, key: str, dest_path: Path) -> Path:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest_path))
        return dest_path

    async def url(self, key: str, expires_in: int = 3600) -> str:
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
        except self.client.exceptions.ClientError:
            return False


@lru_cache
def get_storage() -> StorageService:
    """Factory — returns the configured storage backend."""
    backend = settings.storage_backend
    if backend == "s3":
        return S3Storage()
    return LocalStorage()
