from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import ValidationError

from ..runtime import is_retryable, retry_call
from ..schema import ExtractionResult


@dataclass(frozen=True)
class ProviderResponse:
    text: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None


class VisionExtractor(ABC):
    provider_name: str

    def __init__(self, config: Any):
        self.config = config
        self.last_attempts = 0
        self.last_elapsed_ms = 0
        self.last_cost_usd: float | None = None
        self.before_request: Callable[[], None] | None = None

    def extract(self, page_image: bytes, form_type_hint: str | None) -> ExtractionResult:
        started = time.monotonic()
        attempts = 0

        def request(repair_text: str | None = None) -> ProviderResponse:
            nonlocal attempts
            attempts += 1
            if self.before_request:
                self.before_request()
            return self._extract_once(page_image, form_type_hint, repair_text=repair_text)

        response, _ = retry_call(
            request,
            max_retries=self.config.max_retries,
            retryable=is_retryable,
        )
        try:
            return ExtractionResult.model_validate_json(response.text)
        except (ValidationError, ValueError):
            repaired, _ = retry_call(
                lambda: request(repair_text=response.text),
                max_retries=self.config.max_retries,
                retryable=is_retryable,
            )
            result = ExtractionResult.model_validate_json(repaired.text)
            return result
        finally:
            self.last_attempts = max(self.last_attempts, attempts)
            self.last_elapsed_ms = round((time.monotonic() - started) * 1000)

    @abstractmethod
    def _extract_once(
        self,
        page_image: bytes,
        form_type_hint: str | None,
        repair_text: str | None = None,
    ) -> ProviderResponse:
        raise NotImplementedError
