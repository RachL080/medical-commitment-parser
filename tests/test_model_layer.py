from __future__ import annotations

import json

import pytest

from model_layer.cache import DiskResultCache
from model_layer.config import ModelLayerConfig
from model_layer.providers.base import ProviderResponse, VisionExtractor
from model_layer.schema import ExtractionResult
from model_layer.service import ExtractionService


def valid_payload() -> str:
    field = {"value": None, "evidence": "", "legibility": "unclear"}
    payload = {name: dict(field) for name in (
        "first_name", "last_name", "id_number", "central_numbers",
        "sample_received_date", "referring_organization", "commitment_numbers",
    )}
    payload["extraction_failed"] = False
    payload["failure_reason"] = None
    return json.dumps(payload)


class FakeExtractor(VisionExtractor):
    def __init__(self, config, outputs):
        super().__init__(config)
        self.outputs = list(outputs)
        self.calls = 0

    def _extract_once(self, page_image, form_type_hint, repair_text=None):
        self.calls += 1
        result = self.outputs.pop(0)
        if isinstance(result, Exception):
            raise result
        return ProviderResponse(text=result)


class RateLimitError(Exception):
    status_code = 429


def test_valid_json_returns_schema_result(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=True, cache_dir=tmp_path)
    fake = FakeExtractor(config, [valid_payload()])
    service = ExtractionService(config, {"gemini": fake})
    result = service.extract(b"image")
    assert isinstance(result, ExtractionResult)
    assert not result.extraction_failed
    assert fake.calls == 1


def test_broken_json_gets_one_repair(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=True, cache_dir=tmp_path)
    fake = FakeExtractor(config, ["{bad", valid_payload()])
    result = ExtractionService(config, {"gemini": fake}).extract(b"image")
    assert not result.extraction_failed
    assert fake.calls == 2


def test_429_retries_then_succeeds(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    monkeypatch.setattr("model_layer.runtime.time.sleep", lambda _delay: None)
    config = ModelLayerConfig(model="test", allow_external_api=True, max_retries=1, cache_dir=tmp_path)
    fake = FakeExtractor(config, [RateLimitError(), valid_payload()])
    result = ExtractionService(config, {"gemini": fake}).extract(b"image")
    assert not result.extraction_failed
    assert fake.calls == 2


def test_disk_cache_avoids_second_provider_call(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=True, cache_dir=tmp_path)
    fake = FakeExtractor(config, [valid_payload()])
    service = ExtractionService(config, {"gemini": fake})
    service.extract(b"same-image")
    service.extract(b"same-image")
    assert fake.calls == 1
    assert DiskResultCache(tmp_path).clear() == 1


def test_fallback_after_primary_failure(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=True, fallback_provider="openai", fallback_model="fallback", cache_dir=tmp_path)
    primary = FakeExtractor(config, [RuntimeError("primary unavailable")])
    fallback = FakeExtractor(config, [valid_payload()])
    result = ExtractionService(config, {"gemini": primary, "openai": fallback}).extract(b"image")
    assert not result.extraction_failed
    assert primary.calls == fallback.calls == 1


def test_failure_returns_empty_result_without_crashing(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=True, max_retries=0, cache_dir=tmp_path)
    fake = FakeExtractor(config, [RuntimeError("unavailable")])
    result = ExtractionService(config, {"gemini": fake}).extract(b"image")
    assert result.extraction_failed
    assert result.first_name.value is None


def test_external_provider_blocked_when_privacy_flag_false(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="test", allow_external_api=False, cache_dir=tmp_path)
    fake = FakeExtractor(config, [valid_payload()])
    result = ExtractionService(config, {"gemini": fake}).extract(b"image")
    assert result.extraction_failed
    assert fake.calls == 0