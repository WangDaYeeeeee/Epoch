import json
from pathlib import Path

from jsonschema import Draft202012Validator

from test_api import request_body

CONTRACT_ROOT = Path(__file__).parents[3] / "contracts" / "analytics" / "v1"


def load_schema(name: str) -> dict[str, object]:
    return json.loads((CONTRACT_ROOT / name).read_text(encoding="utf-8"))


def test_request_fixture_matches_shared_schema() -> None:
    Draft202012Validator(load_schema("calculation-request.schema.json")).validate(request_body())


def test_response_fixture_matches_shared_schema() -> None:
    response = {
        **request_body(),
        "engineVersion": "epoch-analytics@0.1.0",
        "modelVersion": "contract-check@1.0.0",
        "status": "succeeded",
        "output": {"accepted": True},
        "diagnostics": {},
        "warnings": [],
        "durationMs": 0,
    }
    response.pop("codeVersion")
    response.pop("strategyVersion")
    response.pop("parameterSetVersion")
    response.pop("payload")
    Draft202012Validator(load_schema("calculation-response.schema.json")).validate(response)
