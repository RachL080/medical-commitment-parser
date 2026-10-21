from __future__ import annotations

import io
import random
import threading
import time
from collections.abc import Callable
from typing import TypeVar

from PIL import Image

T = TypeVar("T")


class RequestsPerMinuteLimiter:
    def __init__(self, requests_per_minute: int):
        self.interval = 60.0 / max(1, requests_per_minute)
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next_allowed - now)
            self._next_allowed = max(now, self._next_allowed) + self.interval
        if delay:
            time.sleep(delay)


def is_retryable(error: Exception) -> bool:
    status = getattr(error, "status_code", None) or getattr(error, "status", None)
    if status is None and getattr(error, "response", None) is not None:
        status = getattr(error.response, "status_code", None)
    return status == 429 or (isinstance(status, int) and 500 <= status <= 599)


def retry_call(operation: Callable[[], T], *, max_retries: int, retryable: Callable[[Exception], bool], base_delay: float = 0.4, max_delay: float = 15.0) -> tuple[T, int]:
    attempts = 0
    while True:
        attempts += 1
        try:
            return operation(), attempts
        except Exception as error:
            if attempts > max_retries or not retryable(error):
                raise
            delay = min(max_delay, base_delay * (2 ** (attempts - 1)))
            time.sleep(delay * random.uniform(0.75, 1.25))


def resize_image(page_image: bytes, max_edge_px: int) -> tuple[bytes, str]:
    with Image.open(io.BytesIO(page_image)) as original:
        image = original.convert("RGB")
        if max(image.size) > max_edge_px:
            scale = max_edge_px / max(image.size)
            size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
            image = image.resize(size, Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=92, optimize=True)
        return output.getvalue(), "image/jpeg"