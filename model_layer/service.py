from __future__ import annotations

import logging
import threading
import time
import warnings
from .cache import DiskResultCache
from .config import ModelLayerConfig
from .factory import create_extractor
from .providers.base import VisionExtractor
from .runtime import RequestsPerMinuteLimiter, resize_image
from .schema import ExtractionResult

logger = logging.getLogger("model_layer")


class ExtractionService:
    def __init__(self, config: ModelLayerConfig, extractors: dict[str, VisionExtractor] | None = None):
        self.config = config
        self.extractors = dict(extractors or {})
        self.cache = DiskResultCache(config.cache_dir) if config.cache_enabled else None
        self.limiter = RequestsPerMinuteLimiter(config.requests_per_minute)
        self._warning_lock = threading.Lock()
        self._external_warning_shown = False
    def _ensure_provider(self, provider: str, model: str) -> VisionExtractor:
        if provider not in self.extractors:
            provider_config = self.config.model_copy(update={"provider": provider, "model": model})
            self.extractors[provider] = create_extractor(provider, provider_config)
        return self.extractors[provider]

    def _call_provider(self, extractor: VisionExtractor, image: bytes, form_type_hint: str | None) -> tuple[ExtractionResult, int]:
        result = extractor.extract(image, form_type_hint)
        return result, getattr(extractor, "last_attempts", 1)

    def extract(self, page_image: bytes, form_type_hint: str | None = None) -> ExtractionResult:
        providers = [(self.config.provider, self.config.model)]
        if self.config.fallback_provider:
            providers.append((self.config.fallback_provider, self.config.fallback_model or self.config.model))

        for index, (provider, model) in enumerate(providers):
            if provider != "local" and not self.config.allow_external_api:
                logger.info("provider=%s skipped=true reason=external_api_disabled", provider)
                if index + 1 == len(providers):
                    return ExtractionResult.failed("External API use is disabled")
                continue
            try:
                extractor = self._ensure_provider(provider, model)
            except Exception as error:
                logger.warning("provider=%s initialization_failed=true error_type=%s", provider, type(error).__name__)
                if index + 1 == len(providers):
                    return ExtractionResult.failed(type(error).__name__)
                continue
            key = DiskResultCache.key(page_image, provider, model, self.config.prompt_version, self.config.schema_version)
            cached = self.cache.get(key) if self.cache else None
            if cached is not None:
                logger.info("provider=%s model=%s elapsed_ms=0 attempts=0 cache_hit=true", provider, model)
                return cached
            if provider != "local":
                self._warn_external_once(provider)

            started = time.monotonic()
            try:
                image, _mime = resize_image(page_image, self.config.max_image_edge_px)
                extractor.before_request = self.limiter.wait
                result, attempts = self._call_provider(extractor, image, form_type_hint)
                elapsed = round((time.monotonic() - started) * 1000)
                logger.info("provider=%s model=%s elapsed_ms=%d attempts=%d cache_hit=false", provider, model, elapsed, attempts)
                if self.cache:
                    self.cache.put(key, result)
                return result
            except Exception as error:
                elapsed = round((time.monotonic() - started) * 1000)
                logger.warning("provider=%s model=%s elapsed_ms=%d attempts=%d cache_hit=false failed=true error_type=%s", provider, model, elapsed, getattr(extractor, "last_attempts", self.config.max_retries + 1), type(error).__name__)
                if index + 1 == len(providers):
                    return ExtractionResult.failed(type(error).__name__)
                logger.info("fallback from=%s to=%s", provider, providers[index + 1][0])
        return ExtractionResult.failed("No provider configured")

    def clear_cache(self) -> int:
        return self.cache.clear() if self.cache else 0

    def _warn_external_once(self, provider: str) -> None:
        with self._warning_lock:
            if self._external_warning_shown:
                return
            warnings.warn(f"External provider '{provider}' receives one page image and extraction instructions. Verify data-processing approval.", RuntimeWarning, stacklevel=2)
            self._external_warning_shown = True
