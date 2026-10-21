from __future__ import annotations

from types import SimpleNamespace

import pytest

from model_layer.config import ModelLayerConfig
from model_layer.providers.anthropic import AnthropicExtractor
from model_layer.providers.gemini import GeminiExtractor
from model_layer.providers.local import LocalExtractor
from model_layer.providers.openai import OpenAIExtractor
from model_layer.schema import ExtractionPayload, FieldValue, Legibility


def make_config(provider: str) -> ModelLayerConfig:
    return ModelLayerConfig(provider=provider, model="mock-model", allow_external_api=True)


def payload_text() -> str:
    text = FieldValue[str](value=None, evidence="", legibility=Legibility.UNCLEAR)
    numbers = FieldValue[list[str]](value=None, evidence="", legibility=Legibility.UNCLEAR)
    return ExtractionPayload(
        first_name=text,
        last_name=text,
        id_number=text,
        central_numbers=numbers,
        sample_received_date=text,
        referring_organization=text,
        commitment_numbers=numbers,
    ).model_dump_json()


def test_gemini_adapter_uses_config_and_structured_json():
    calls = []
    response = SimpleNamespace(text=payload_text(), usage_metadata=None)
    client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: calls.append(kwargs) or response))
    schema = SimpleNamespace(model_validate_json=lambda value: value)
    types = SimpleNamespace(
        Part=SimpleNamespace(from_bytes=lambda **kwargs: kwargs),
        Schema=schema,
        GenerateContentConfig=lambda **kwargs: SimpleNamespace(**kwargs),
    )
    result = GeminiExtractor(make_config("gemini"), client, types)._extract_once(b"page", None, "repair")
    assert result.text == response.text
    assert calls[0]["model"] == "mock-model"
    assert calls[0]["config"].response_mime_type == "application/json"
    assert "repair" in calls[0]["contents"][1]


def test_anthropic_adapter_sends_image_and_json_schema():
    calls = []
    response = SimpleNamespace(content=[SimpleNamespace(type="text", text=payload_text())], usage=None)
    client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or response))
    result = AnthropicExtractor(make_config("anthropic"), client)._extract_once(b"page", None)
    assert result.text == response.content[0].text
    assert calls[0]["messages"][0]["content"][0]["type"] == "image"
    assert calls[0]["output_config"]["format"]["type"] == "json_schema"


def test_openai_adapter_sends_image_and_strict_json_schema():
    calls = []
    response = SimpleNamespace(output_text=payload_text(), usage=None)
    client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or response))
    result = OpenAIExtractor(make_config("openai"), client)._extract_once(b"page", None)
    assert result.text == response.output_text
    assert calls[0]["input"][0]["content"][1]["type"] == "input_image"
    assert calls[0]["text"]["format"]["strict"] is True


def test_local_adapter_is_optional_todo():
    with pytest.raises(NotImplementedError):
        LocalExtractor(make_config("local"))._extract_once(b"page", None)