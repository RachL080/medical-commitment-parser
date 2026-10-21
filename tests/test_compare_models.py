from __future__ import annotations

from model_layer.schema import ExtractionResult, FieldValue, Legibility
from scripts.compare_models import FIELDS, evaluate, normalize, parse_models


class FakeExtractor:
    def __init__(self, result):
        self.result = result
        self.last_cost_usd = None

    def extract(self, _image, _hint):
        return self.result


def make_result():
    clear = lambda value: FieldValue(value=value, evidence="visible", legibility=Legibility.CLEAR)
    partial = lambda value: FieldValue(value=value, evidence="handwriting", legibility=Legibility.PARTIAL)
    return ExtractionResult(
        first_name=clear("Dana"),
        last_name=clear("Cohen"),
        id_number=partial("00123"),
        central_numbers=clear(["12", "34"]),
        sample_received_date=clear("2026-01-02"),
        referring_organization=clear("Example HMO"),
        commitment_numbers=clear(["555"]),
    )


def test_normalization_is_exact_and_not_fuzzy():
    assert normalize("  Ab-12 ") == normalize("ab - 12")
    assert normalize("00123") == normalize("123")
    assert normalize("Dana") != normalize("Danna")


def test_parse_model_targets():
    assert parse_models("gemini:model-a,openai:model-b") == [("gemini", "model-a"), ("openai", "model-b")]


def test_evaluation_metrics_include_flagged_errors(tmp_path, monkeypatch):
    import scripts.compare_models as comparison

    result = make_result()
    monkeypatch.setattr(comparison, "create_extractor", lambda _provider, _config: FakeExtractor(result))
    image = tmp_path / "page.png"
    image.write_bytes(b"not-decoded-by-fake")
    rows = [{
        "image": "page.png",
        "first_name": "Dana",
        "last_name": "Cohen",
        "id_number": "00999",
        "central_numbers": "12,34",
        "sample_received_date": "2026-01-02",
        "referring_organization": "Example HMO",
        "commitment_numbers": "555",
    }]
    base = {"temperature": 0, "max_retries": 0, "requests_per_minute": 100, "allowed_referring_organizations": []}
    records = evaluate("local", "mock", tmp_path, rows, base)
    id_record = next(item for item in records if item["field"] == "id_number")
    assert id_record["wrong_pct"] == 100
    assert id_record["wrong_flagged_partial_unclear_pct"] == 100
    assert len(records) == len(FIELDS)