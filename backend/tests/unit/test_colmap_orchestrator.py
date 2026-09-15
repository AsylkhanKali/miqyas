"""Unit tests for COLMAP model-output handling."""

from unittest.mock import AsyncMock

import pytest

from app.services.colmap_orchestrator import COLMAPOrchestrator


@pytest.fixture(autouse=True)
def setup_database():
    """Override the suite-wide database fixture for these pure unit tests."""
    yield


@pytest.mark.asyncio
async def test_convert_models_to_text_converts_binary_model(tmp_path):
    model_dir = tmp_path / "0"
    model_dir.mkdir()
    (model_dir / "images.bin").write_bytes(b"binary model")

    orchestrator = COLMAPOrchestrator(db=None)
    orchestrator._run_colmap_cmd = AsyncMock()

    await orchestrator._convert_models_to_text(tmp_path)

    orchestrator._run_colmap_cmd.assert_awaited_once_with(
        [
            "colmap", "model_converter",
            "--input_path", str(model_dir),
            "--output_path", str(model_dir),
            "--output_type", "TXT",
        ],
        "model_converter (0)",
    )


@pytest.mark.asyncio
async def test_convert_models_to_text_skips_existing_text_model(tmp_path):
    model_dir = tmp_path / "0"
    model_dir.mkdir()
    (model_dir / "images.txt").write_text("# already exported\n")

    orchestrator = COLMAPOrchestrator(db=None)
    orchestrator._run_colmap_cmd = AsyncMock()

    await orchestrator._convert_models_to_text(tmp_path)

    orchestrator._run_colmap_cmd.assert_not_awaited()
