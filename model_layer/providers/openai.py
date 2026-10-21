from __future__ import annotations

import base64
import os

from ..config import ModelLayerConfig
from ..prompt import SYSTEM_INSTRUCTIONS, build_prompt
from ..schema import ExtractionPayload
from .base import ProviderResponse, VisionExtractor


class OpenAIExtractor(VisionExtractor):
    provider_name = "openai"

    def __init__(self, config: ModelLayerConfig, client=None):
        super().__init__(config)
        if client is None:
            from openai import OpenAI

            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError("OPENAI_API_KEY is required")
            client = OpenAI(api_key=api_key, max_retries=0)
        self.client = client

    def _extract_once(self, page_image: bytes, form_type_hint: str | None, repair_text: str | None = None) -> ProviderResponse:
        image_url = "data:image/jpeg;base64," + base64.b64encode(page_image).decode("ascii")
        response = self.client.responses.create(
            model=self.config.model,
            temperature=0,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": SYSTEM_INSTRUCTIONS + "\\n" + build_prompt(self.config, form_type_hint, repair_text)},
                    {"type": "input_image", "image_url": image_url, "detail": "original"},
                ],
            }],
            text={"format": {"type": "json_schema", "name": "page_extraction", "strict": True, "schema": ExtractionPayload.model_json_schema()}},
        )
        text = getattr(response, "output_text", None)
        if not text:
            raise ValueError("OpenAI returned an empty response")
        usage = getattr(response, "usage", None)
        return ProviderResponse(text=text, input_tokens=getattr(usage, "input_tokens", None), output_tokens=getattr(usage, "output_tokens", None))
