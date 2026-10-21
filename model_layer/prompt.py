from __future__ import annotations

from .config import ModelLayerConfig

SYSTEM_INSTRUCTIONS = """Extract one Hebrew medical commitment-form page as JSON matching the supplied schema.
If a field is unclear or absent, return null. Do not guess.
For every field return brief visible evidence and legibility: clear, partial, or unclear. Never return numeric confidence.
Preserve leading zeroes. Read handwriting only when legible.
If a combined full-name field is used, the last word is family name and preceding words are given name. Prefer separately labeled name fields.
The referring organization must match the supplied closed list; do not infer from an issuer logo alone.
"""


def build_prompt(config: ModelLayerConfig, form_type_hint: str | None, repair_text: str | None = None) -> str:
    allowed = "\n".join(f"- {organization}" for organization in config.allowed_referring_organizations)
    hint = form_type_hint or "none"
    prompt = (
        f"Form type hint: {hint}\n"
        "Extract these fields: first name, last name, identity number, central numbers (list), sample received date, referring organization, commitment numbers (list).\n"
        f"Allowed referring organizations (closed list; otherwise null):\n{allowed or '- none configured'}\n"
        "Use null for missing scalar values and null for missing list values. Evidence must quote or briefly describe visible image content. "
        "Dates must be ISO YYYY-MM-DD only when unambiguous. Preserve number strings exactly."
    )
    if repair_text is not None:
        prompt += "\nRepair the following invalid JSON to match the schema exactly. Do not infer or add data:\n" + repair_text
    return prompt
