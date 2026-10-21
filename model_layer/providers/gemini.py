from __future__ import annotations

import base64
import os

from ..config import ModelLayerConfig
from ..prompt import SYSTEM_INSTRUCTIONS, build_prompt
from ..schema import ExtractionPayload
from .base import ProviderResponse, VisionExtractor


class GeminiExtractor(VisionExtractor):
    provider_name = "gemini"

    def __init__(self, config: ModelLayerConfig, client=None, types_module=None):
        super().__init__(config)
        self._types = types_module
        if client is None:
            from google import genai
            from google.genai import types

            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY is required")
            client = genai.Client(api_key=api_key)
            self._types = types
        self.client = client

    def _extract_once(self, page_image: bytes, form_type_hint: str | None, repair_text: str | None = None) -> ProviderResponse:
        types = self._types
        if types is None:
            raise RuntimeError("Gemini SDK types module is unavailable; install the Gemini extra or inject types_module")

        prompt = build_prompt(self.config, form_type_hint, repair_text)
        response = self.client.models.generate_content(
            model=self.config.model,
            contents=[types.Part.from_bytes(data=page_image, mime_type="image/jpeg"), prompt],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTIONS,
                temperature=0,
                response_mime_type="application/json",
                response_schema=ExtractionPayload.model_json_schema(),
            ),
        )
        text = getattr(response, "text", None)
        if not text:
            raise ValueError("Gemini returned an empty response")
        usage = getattr(response, "usage_metadata", None)
        return ProviderResponse(text=text, input_tokens=getattr(usage, "prompt_token_count", None), output_tokens=getattr(usage, "candidates_token_count", None))
