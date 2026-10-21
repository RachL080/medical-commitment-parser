# Vision model layer

Independent one-page extraction package. It is intentionally separate from the existing TypeScript/Express backend and does not replace PDF rendering, orientation correction, form classification, normalization, validation, or export. The integration boundary is `ExtractionService.extract(page_image: bytes, form_type_hint: str | None)`.

## Install

Use the repository virtual environment and install only the provider SDKs needed:

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[test,gemini]"
```

Optional extras: `gemini`, `anthropic`, `openai`. Pillow handles page-image downscaling. The local Ollama/vLLM adapter is an explicit TODO and makes no external call.

## Configure

Provider and model are selected through `model_layer/config.yaml` and environment variables. API keys are read only from environment variables; do not put them in YAML or source files.

```powershell
$env:MODEL_PROVIDER = "gemini"
$env:GEMINI_MODEL = "<model available to this account>"
$env:GEMINI_API_KEY = "<local secret>"
$env:ALLOW_EXTERNAL_API = "true"
```

For Anthropic use `MODEL_PROVIDER=anthropic`, `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`; for OpenAI use `MODEL_PROVIDER=openai`, `OPENAI_MODEL`, `OPENAI_API_KEY`. A provider change requires configuration/env only. `allow_external_api: false` prevents every external provider; only local is allowed.

Gemini model IDs and free-tier quotas are not asserted: Google's official model/rate-limit docs were blocked by this environment's gateway on 2026-10-18. Verify the model and quota in the account before enabling. The configured provider defaults to Gemini, but the model must be supplied through `GEMINI_MODEL`.

The first external request emits one warning that the page image and extraction prompt are sent to the configured service. Logs include provider/model/timing/attempts/cache status only, never page content or extracted personal data. The disk cache stores validated result JSON only, never source images. Clear it with one command:

```powershell
.\.venv\Scripts\python.exe -m model_layer.cli clear-cache --config model_layer/config.yaml
```

## Result contract

`VisionExtractor.extract(page_image: bytes, form_type_hint: str | None)` returns `ExtractionResult`. Provider JSON contains exactly seven fields: `first_name`, `last_name`, `id_number`, `central_numbers`, `sample_received_date`, `referring_organization`, `commitment_numbers`. Each field has `value` (nullable), short `evidence`, and `legibility` (`clear`, `partial`, `unclear`). Numeric model confidence is not used. Operational failure metadata is added by the service wrapper and is not requested from the model.

## Run tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

All tests use mocks and require no provider keys.

## Compare providers

Ground-truth CSV columns: `image`, followed by all seven result fields. List model targets as comma-separated `provider:model` pairs. The script reads local page images and calls the configured providers; use only approved data.

```powershell
.\.venv\Scripts\python.exe scripts/compare_models.py --images tests/fixtures --ground-truth tests/ground_truth.csv --models gemini:$env:GEMINI_MODEL,openai:$env:OPENAI_MODEL --output reports/model-comparison.csv
```

It prints a terminal table and writes CSV with exact normalized correctness/null/wrong rates, the fraction of wrong results flagged `partial`/`unclear`, mean latency, failures and cost when available. Comparison normalizes whitespace, hyphen variants and leading zeroes only; there is no fuzzy matching.

## Add a provider

1. Add a separate adapter subclassing `VisionExtractor` and implement `_extract_once`.
2. Pass the shared `ExtractionPayload` schema for structured output and return `ProviderResponse`.
3. Register it in `model_layer/factory.py`; add the SDK under optional dependencies in `pyproject.toml`.
4. Add mocked tests for image/schema request construction and service tests for retry, cache, fallback and privacy.
5. Verify current official model/image/structured-output/rate-limit documentation and record URL/date in `model_layer/config.yaml`. Never invent a model ID or quota.

## Official documentation checked 2026-10-18

- Anthropic models: https://platform.claude.com/docs/en/about-claude/models/overview
- Anthropic image input: https://platform.claude.com/docs/en/build-with-claude/vision
- Anthropic structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic limits: https://platform.claude.com/docs/en/api/rate-limits
- OpenAI image input: https://developers.openai.com/api/docs/guides/images-vision
- OpenAI model capabilities: https://developers.openai.com/api/docs/models/gpt-5-mini
- OpenAI limits/free eligibility: https://developers.openai.com/api/docs/guides/rate-limits
- Gemini docs were inaccessible behind this environment's network gateway; verify before use: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/rate-limits
