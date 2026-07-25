from fastapi.testclient import TestClient

from epoch_analytics_service.api import app

client = TestClient(app)


def request_body(calculation_type: str = "contract-check") -> dict[str, object]:
    return {
        "contractVersion": "1.0",
        "calculationId": "76cc25cc-ad83-426d-9494-b699f4825b6a",
        "calculationType": calculation_type,
        "asOf": "2026-07-21T00:00:00Z",
        "inputHash": "a" * 64,
        "codeVersion": "test",
        "strategyVersion": "epoch-satellite-v0.1.0",
        "parameterSetVersion": "default-draft-v0.1.0",
        "payload": {"series": []},
    }


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "epoch-analytics",
        "version": "epoch-analytics@0.1.0",
    }


def test_contract_check_round_trip() -> None:
    response = client.post("/v1/calculations/run", json=request_body())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["output"] == {"accepted": True}
    assert body["diagnostics"] == {"payloadKeys": ["series"]}


def test_unknown_calculation_is_not_silently_accepted() -> None:
    response = client.post("/v1/calculations/run", json=request_body("shar-iv-j"))
    assert response.status_code == 501
    assert response.json()["detail"] == "Unsupported calculation type: shar-iv-j"
