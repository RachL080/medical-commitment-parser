from __future__ import annotations

from .config import ModelLayerConfig
from .providers.anthropic import AnthropicExtractor
from .providers.base import VisionExtractor
from .providers.gemini import GeminiExtractor
from .providers.local import LocalExtractor
from .providers.openai import OpenAIExtractor

PROVIDERS = {
    "gemini": GeminiExtractor,
    "anthropic": AnthropicExtractor,
    "openai": OpenAIExtractor,
    "local": LocalExtractor,
}


def create_extractor(provider: str, config: ModelLayerConfig) -> VisionExtractor:
    try:
        adapter = PROVIDERS[provider]
    except KeyError as error:
        raise ValueError(f"Unsupported provider: {provider}") from error
    if provider != "local" and not config.allow_external_api:
        raise PermissionError("External model APIs are disabled")
    return adapter(config)