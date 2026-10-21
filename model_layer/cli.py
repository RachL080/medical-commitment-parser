from __future__ import annotations

import argparse
from pathlib import Path

import yaml

from .cache import DiskResultCache


def main() -> None:
    parser = argparse.ArgumentParser(prog="model-layer")
    parser.add_argument("command", choices=["clear-cache"])
    parser.add_argument("--config", default="model_layer/config.yaml")
    args = parser.parse_args()
    if args.command == "clear-cache":
        raw = yaml.safe_load(Path(args.config).read_text(encoding="utf-8")) or {}
        cache_dir = Path(raw.get("cache_dir", ".cache/model-layer"))
        cache = DiskResultCache(cache_dir)
        print(f"Removed {cache.clear()} cached result(s) from {cache_dir}")


if __name__ == "__main__":
    main()
