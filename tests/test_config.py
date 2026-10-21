from __future__ import annotations

import pytest
from pydantic import ValidationError

from model_layer.config import ModelLayerConfig, load_config


def test_provider_and_model_switch_from_environment(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "provider: gemini\nmodel: ${GEMINI_MODEL}\ntemperature: 0\nallow_external_api: false\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("MODEL_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_MODEL", "mock-vision-model")
    loaded = load_config(config_path)
    assert loaded.provider == "openai"
    assert loaded.model == "mock-vision-model"
    assert loaded.allow_external_api is False


def test_model_name_is_required(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("provider: gemini\nmodel: ${GEMINI_MODEL}\n", encoding="utf-8")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    with pytest.raises(ValueError, match="GEMINI_MODEL"):
        load_config(config_path)


def test_temperature_must_be_zero():
    with pytest.raises(ValidationError, match="temperature=0"):
        ModelLayerConfig(provider="local", model="local-test", temperature=0.2)


def test_unknown_provider_is_rejected():
    with pytest.raises(ValidationError, match="Unsupported provider"):
        ModelLayerConfig(provider="unknown", model="model")