from __future__ import annotations

import argparse
import csv
import logging
import re
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from model_layer.config import ModelLayerConfig
from model_layer.factory import create_extractor
from model_layer.schema import Legibility

FIELDS = (
    "first_name", "last_name", "id_number", "central_numbers",
    "sample_received_date", "referring_organization", "commitment_numbers",
)


def normalize(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "|".join(sorted(normalize(item) for item in value))
    text = re.sub(r"\s+", " ", str(value)).strip().casefold()
    text = re.sub(r"[‐‑‒–—−]", "-", text)
    text = re.sub(r"\s*-\s*", "-", text)
    if re.fullmatch(r"[0-9,| -]+", text):
        numbers = re.split(r"[,|\s]+", text)
        return "|".join(sorted(item.lstrip("0") or "0" for item in numbers if item))
    return text


def parse_models(specification: str) -> list[tuple[str, str]]:
    parsed = []
    for target in specification.split(","):
        provider, separator, model = target.partition(":")
        if not separator or not provider.strip() or not model.strip():
            raise ValueError(f"Invalid model target: {target}; expected provider:model")
        parsed.append((provider.strip(), model.strip()))
    return parsed


def evaluate(provider: str, model: str, images: Path, rows: list[dict[str, str]], base: dict[str, Any]) -> list[dict[str, Any]]:
    settings = dict(base)
    settings.update(provider=provider, model=model, fallback_provider=None, fallback_model=None,
                    allow_external_api=provider != "local", cache_enabled=False)
    config = ModelLayerConfig.model_validate(settings)
    extractor = create_extractor(provider, config)
    stats: dict[str, dict[str, int]] = defaultdict(lambda: dict(total=0, correct=0, null=0, wrong=0, flagged=0))
    timings: list[int] = []
    failures = 0
    total_cost = 0.0
    cost_known = False
    for row in rows:
        path = images / row["image"]
        try:
            started = time.monotonic()
            result = extractor.extract(path.read_bytes(), row.get("form_type_hint") or None)
            timings.append(round((time.monotonic() - started) * 1000))
            failures += int(result.extraction_failed)
            for field in FIELDS:
                actual = getattr(result, field)
                expected = row[field]
                item = stats[field]
                item["total"] += 1
                item["null"] += int(actual.value is None or actual.value == [])
                if normalize(actual.value) == normalize(expected):
                    item["correct"] += 1
                else:
                    item["wrong"] += 1
                    item["flagged"] += int(actual.legibility in (Legibility.PARTIAL, Legibility.UNCLEAR))
            if extractor.last_cost_usd is not None:
                total_cost += extractor.last_cost_usd
                cost_known = True
        except Exception as error:
            logging.warning("image=%s failed type=%s", row.get("image"), type(error).__name__)
            failures += 1
            for field in FIELDS:
                stats[field]["total"] += 1
                stats[field]["null"] += 1
                stats[field]["wrong"] += 1
                stats[field]["flagged"] += 1

    output = []
    for field in FIELDS:
        item = stats[field]
        total = item["total"] or 1
        output.append({
            "provider": provider, "model": model, "field": field, "samples": item["total"],
            "correct_pct": round(100 * item["correct"] / total, 2),
            "null_pct": round(100 * item["null"] / total, 2),
            "wrong_pct": round(100 * item["wrong"] / total, 2),
            "wrong_flagged_partial_unclear_pct": round(100 * item["flagged"] / item["wrong"], 2) if item["wrong"] else 0,
            "mean_page_ms": round(statistics.mean(timings), 2) if timings else 0,
            "failed_requests": failures,
            "estimated_cost_usd": round(total_cost, 6) if cost_known else "",
        })
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare vision extractors against local ground truth.")
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--ground-truth", type=Path, required=True)
    parser.add_argument("--models", required=True, help="Comma-separated provider:model list")
    parser.add_argument("--config", type=Path, default=ROOT / "model_layer/config.yaml")
    parser.add_argument("--output", type=Path, default=Path("model-comparison.csv"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    with args.ground_truth.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    required = {"image", *FIELDS}
    if not rows or not required.issubset(rows[0]):
        raise SystemExit(f"Ground-truth CSV must contain columns: {', '.join(sorted(required))}")
    base = yaml.safe_load(args.config.read_text(encoding="utf-8")) or {}
    results = [record for provider, model in parse_models(args.models)
               for record in evaluate(provider, model, args.images, rows, base)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=list(results[0]))
        writer.writeheader()
        writer.writerows(results)
    print("provider,model,field,correct%,null%,wrong%,wrong-flagged%,mean-ms,failures,cost-usd")
    for row in results:
        print(f"{row['provider']},{row['model']},{row['field']},{row['correct_pct']},{row['null_pct']},{row['wrong_pct']},{row['wrong_flagged_partial_unclear_pct']},{row['mean_page_ms']},{row['failed_requests']},{row['estimated_cost_usd']}")
    print(f"CSV written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())