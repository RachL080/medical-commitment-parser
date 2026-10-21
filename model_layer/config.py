from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ModelLayerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = "gemini"
    model: str
    temperature: float = 0.0
    max_retries: int = 3
    requests_per_minute: int = 10
    fallback_provider: str | None = None
    fallback_model: str | None = None
    allow_external_api: bool = False
    max_image_edge_px: int = 2000
    cache_dir: Path = Path(".cache/model-layer")
    prompt_version: str = "1"
    schema_version: str = "1"
    cache_enabled: bool = True
    allowed_referring_organizations: list[str] = Field(default_factory=list)
    provider_models: dict[str, str] = Field(default_factory=dict)

    @field_validator("provider", "fallback_provider")
    @classmethod
    def validate_provider(cls, value: str | None) -> str | None:
        if value is not None and value not in {"gemini", "anthropic", "openai", "local"}:
            raise ValueError(f"Unsupported provider: {value}")
        return value

    @field_validator("temperature")
    @classmethod
    def require_deterministic_temperature(cls, value: float) -> float:
        if value != 0:
            raise ValueError("Form extraction requires temperature=0")
        return value


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        if value.startswith("${") and value.endswith("}"):
            variable = value[2:-1]
            return os.environ.get(variable, "")
        return value
    if isinstance(value, list):
        return [_expand_env(item) for item in value]
    if isinstance(value, dict):
        return {key: _expand_env(item) for key, item in value.items()}
    return value


def load_config(path: Path | str = "model_layer/config.yaml") -> ModelLayerConfig:
    config_path = Path(path)
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    merged = _expand_env(raw)
    provider = os.environ.get("MODEL_PROVIDER", merged.get("provider", "gemini"))
    model_env_names = {
        "gemini": "GEMINI_MODEL",
        "anthropic": "ANTHROPIC_MODEL",
        "openai": "OPENAI_MODEL",
        "local": "LOCAL_MODEL",
    }
    model = (
        os.environ.get("MODEL_NAME")
        or os.environ.get(model_env_names[provider])
        or merged.get("provider_models", {}).get(provider)
        or merged.get("model", "")
    )
    merged["provider"] = provider
    merged["model"] = model
    merged["fallback_provider"] = os.environ.get("FALLBACK_PROVIDER", merged.get("fallback_provider")) or None
    merged["fallback_model"] = os.environ.get("FALLBACK_MODEL", merged.get("fallback_model")) or None
    merged["allow_external_api"] = os.environ.get(
        "ALLOW_EXTERNAL_API", str(merged.get("allow_external_api", False))
    ).lower() in {"1", "true", "yes"}
    merged["requests_per_minute"] = int(os.environ.get("MODEL_REQUESTS_PER_MINUTE", merged.get("requests_per_minute", 10)))
    if not model:
        raise ValueError(f"Set {model_env_names[provider]} (or MODEL_NAME) in the environment for provider '{provider}'")
    return ModelLayerConfig.model_validate(merged)
