"""Loads the shared model config used by both the web app and the workers."""

import json
import os
from pathlib import Path
from typing import Any

_DEFAULT = (
    Path(__file__).resolve().parents[4] / "packages" / "shared" / "src" / "llm" / "models.json"
)


def config_path() -> Path:
    return Path(os.environ.get("LLM_MODELS_CONFIG", _DEFAULT))


def load_config(path: Path | None = None) -> dict[str, Any]:
    return json.loads((path or config_path()).read_text(encoding="utf-8"))
