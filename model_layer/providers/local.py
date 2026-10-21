from __future__ import annotations

from ..config import ModelLayerConfig
from .base import ProviderResponse, VisionExtractor


class LocalExtractor(VisionExtractor):
    provider_name = "local"

    def __init__(self, config: ModelLayerConfig, client=None):
        self.config = config
        self.client = client

    def _extract_once(self, page_image: bytes, form_type_hint: str | None, repair_text: str | None = None) -> ProviderResponse:
        # TODO: implement a local Ollama/vLLM vision request.
        raise NotImplementedError("Configure a local Ollama/vLLM vision client in LocalExtractor")

    def extract_raw(self, page_image: bytes, form_type_hint: str | None) -> ProviderResponse:
        # TODO: implement an Ollama or vLLM OpenAI-compatible vision endpoint.
        # Keep endpoint/model selection in config and never forward bytes externally.
        if self.client is None:
            raise NotImplementedError("Configure a local Ollama/vLLM vision client in LocalExtractor")
        raise NotImplementedError("Local vision request adapter is not implemented yet")
