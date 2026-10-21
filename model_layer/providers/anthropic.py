from __future__ import annotations

import base64
import os

from ..config import ModelLayerConfig
from ..prompt import SYSTEM_INSTRUCTIONS, build_prompt
from .base import ProviderResponse, VisionExtractor


class AnthropicExtractor(VisionExtractor):
    provider_name = "anthropic"

    def __init__(self, config: ModelLayerConfig, client=None):
        super().__init__(config)
        if client is None:
            import anthropic

            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY is required")
            client = anthropic.Anthropic(api_key=api_key, max_retries=0)
        self.client = client

    def _extract_once(self, page_image: bytes, form_type_hint: str | None, repair_text: str | None = None) -> ProviderResponse:
        from ..schema import ExtractionPayload

        response = self.client.messages.create(
            model=self.config.model,
            max_tokens=1800,
            temperature=0,
            system=SYSTEM_INSTRUCTIONS,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(page_image).decode("ascii")}},
                    {"type": "text", "text": build_prompt(self.config, form_type_hint, repair_text)},
                ],
            }],
            output_config={"format": {"type": "json_schema", "schema": ExtractionPayload.model_json_schema()}},
        )
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        if not text:
            raise ValueError("Anthropic returned an empty response")
        usage = getattr(response, "usage", None)
        return ProviderResponse(text=text, input_tokens=getattr(usage, "input_tokens", None), output_tokens=getattr(usage, "output_tokens", None))
