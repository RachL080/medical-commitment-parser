from __future__ import annotations

import json

from model_layer.cache import DiskResultCache
from model_layer.config import ModelLayerConfig
from model_layer.providers.base import ProviderResponse, VisionExtractor
from model_layer.service import ExtractionService


def empty_payload() -> str:
    scalar = {"value": None, "evidence": "", "legibility": "unclear"}
    values = {name: dict(scalar) for name in (
        "first_name", "last_name", "id_number", "sample_received_date", "referring_organization",
    )}
    values["central_numbers"] = dict(scalar)
    values["commitment_numbers"] = dict(scalar)
    return json.dumps(values)


class FailingExtractor(VisionExtractor):
    def __init__(self, config, message):
        super().__init__(config)
        self.message = message
        self.calls = 0

    def _extract_once(self, page_image, form_type_hint, repair_text=None):
        self.calls += 1
        raise RuntimeError(self.message)


def test_cache_key_includes_every_version_dimension():
    image = b"same page"
    base = DiskResultCache.key(image, "gemini", "m1", "p1", "s1")
    assert base != DiskResultCache.key(image, "openai", "m1", "p1", "s1")
    assert base != DiskResultCache.key(image, "gemini", "m2", "p1", "s1")
    assert base != DiskResultCache.key(image, "gemini", "m1", "p2", "s1")
    assert base != DiskResultCache.key(image, "gemini", "m1", "p1", "s2")


def test_fallback_exhaustion_returns_failed_result(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="primary", allow_external_api=True, fallback_provider="openai", fallback_model="secondary", max_retries=0, cache_dir=tmp_path)
    primary = FailingExtractor(config, "primary down")
    fallback = FailingExtractor(config, "fallback down")
    result = ExtractionService(config, {"gemini": primary, "openai": fallback}).extract(b"page")
    assert result.extraction_failed is True
    assert result.first_name.value is None
    assert primary.calls == fallback.calls == 1


def test_external_provider_is_skipped_for_local_fallback_when_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr("model_layer.service.resize_image", lambda image, _edge: (image, "image/jpeg"))
    config = ModelLayerConfig(model="external-model", allow_external_api=False, fallback_provider="local", fallback_model="local-model", cache_dir=tmp_path)
    external = FailingExtractor(config, "must not be called")
    local = FakeLocalExtractor(config, [empty_payload()])
    result = ExtractionService(config, {"gemini": external, "local": local}).extract(b"page")
    assert not result.extraction_failed
    assert external.calls == 0
    assert local.calls == 1


class FakeLocalExtractor(VisionExtractor):
    def __init__(self, config, outputs):
        super().__init__(config)
        self.outputs = list(outputs)
        self.calls = 0

    def _extract_once(self, page_image, form_type_hint, repair_text=None):
        self.calls += 1
        return ProviderResponse(text=self.outputs.pop(0))


def test_result_schema_contains_only_seven_model_fields():
    from model_layer.schema import ExtractionPayload

    assert set(ExtractionPayload.model_fields) == {
        "first_name", "last_name", "id_number", "central_numbers",
        "sample_received_date", "referring_organization", "commitment_numbers",
    }
    assert set(ExtractionPayload.model_fields).issubset(ExtractionPayload.model_json_schema()["properties"])