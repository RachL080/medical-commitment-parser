from __future__ import annotations

from enum import StrEnum
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field


class Legibility(StrEnum):
    CLEAR = "clear"
    PARTIAL = "partial"
    UNCLEAR = "unclear"


ValueT = TypeVar("ValueT")


class FieldValue(BaseModel, Generic[ValueT]):
    model_config = ConfigDict(extra="forbid")

    value: ValueT | None = Field(...)
    evidence: str = Field(...)
    legibility: Legibility = Field(...)


class ExtractionPayload(BaseModel):
    """Provider-facing schema with exactly the seven requested fields."""

    model_config = ConfigDict(extra="forbid")

    first_name: FieldValue[str] = Field(...)
    last_name: FieldValue[str] = Field(...)
    id_number: FieldValue[str] = Field(...)
    central_numbers: FieldValue[list[str]] = Field(...)
    sample_received_date: FieldValue[str] = Field(...)
    referring_organization: FieldValue[str] = Field(...)
    commitment_numbers: FieldValue[list[str]] = Field(...)


class ExtractionResult(ExtractionPayload):
    """Operational result wrapper; failure metadata is not sent to providers."""

    extraction_failed: bool = False
    failure_reason: str | None = None

    @classmethod
    def failed(cls, reason: str) -> ExtractionResult:
        def unclear_string() -> FieldValue[str]:
            return FieldValue[str](value=None, evidence="", legibility=Legibility.UNCLEAR)

        def unclear_list() -> FieldValue[list[str]]:
            return FieldValue[list[str]](value=None, evidence="", legibility=Legibility.UNCLEAR)

        return cls(
            first_name=unclear_string(),
            last_name=unclear_string(),
            id_number=unclear_string(),
            central_numbers=unclear_list(),
            sample_received_date=unclear_string(),
            referring_organization=unclear_string(),
            commitment_numbers=unclear_list(),
            extraction_failed=True,
            failure_reason=reason,
        )
