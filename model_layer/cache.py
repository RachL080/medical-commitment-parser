from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .schema import ExtractionResult


class DiskResultCache:
    """Stores validated result JSON only; input page bytes are never persisted."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(page_image: bytes, provider: str, model: str, prompt_version: str, schema_version: str) -> str:
        digest = hashlib.sha256()
        digest.update(page_image)
        digest.update(b"\0")
        digest.update(provider.encode())
        digest.update(b"\0")
        digest.update(model.encode())
        digest.update(b"\0")
        digest.update(prompt_version.encode())
        digest.update(b"\0")
        digest.update(schema_version.encode())
        return digest.hexdigest()

    def get(self, key: str) -> ExtractionResult | None:
        path = self.directory / f"{key}.json"
        if not path.is_file():
            return None
        try:
            return ExtractionResult.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            path.unlink(missing_ok=True)
            return None

    def put(self, key: str, result: ExtractionResult) -> None:
        path = self.directory / f"{key}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(result.model_dump_json(), encoding="utf-8")
        temporary.replace(path)

    def clear(self) -> int:
        removed = 0
        for path in self.directory.glob("*.json"):
            path.unlink(missing_ok=True)
            removed += 1
        return removed
