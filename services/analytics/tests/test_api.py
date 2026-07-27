from datetime import date, timedelta

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


def portfolio_risk_request() -> dict[str, object]:
    body = request_body("portfolio-risk")
    start = date(2025, 1, 1)
    dates = [(start + timedelta(days=index)).isoformat() for index in range(250)]
    body["payload"] = {
        "schemaVersion": "portfolio-risk-input/1.0",
        "asOf": "2026-07-21T00:00:00Z",
        "baseCurrency": "USD",
        "weightDefinition": "market_value_usd_over_net_nav_cash_in_denominator",
        "marketDataDefinition": {
            "priceAdjustment": "split_adjusted",
            "ohlcCurrency": "usd_using_same_date_fx_close",
            "returnMethod": "common_date_close_to_close_usd",
            "dividendTreatment": "excluded",
        },
        "positions": [{"instrumentId": "US:AAA", "weight": 1.0}],
        "series": [{
            "instrumentId": "US:AAA",
            "bars": [
                {"date": value, "open": 100, "high": 101, "low": 99, "close": 100.5}
                for value in dates[-60:]
            ],
            "returnsUsd": [
                {"date": value, "value": (index % 5 - 2) / 100}
                for index, value in enumerate(dates)
            ],
        }],
    }
    return body


def test_portfolio_risk_calculation_uses_the_versioned_envelope() -> None:
    response = client.post("/v1/calculations/run", json=portfolio_risk_request())
    assert response.status_code == 200
    body = response.json()
    assert body["calculationType"] == "portfolio-risk"
    assert body["status"] == "degraded"
    assert body["modelVersion"] == "portfolio-risk-shar-daily-j-no-iv@1.0.0"
    assert body["diagnostics"]["semivarianceResolution"] == "daily_approximation"
    assert body["diagnostics"]["ivInputStatus"] == "unavailable_omitted"
    assert body["output"]["schemaVersion"] == "portfolio-risk-output/1.0"
    assert body["output"]["policyGate"]["limitAnnualized"] == 0.45
    assert body["diagnostics"]["volatilityWindowTradingDays"] == 250
    assert body["diagnostics"]["correlationWindowTradingDays"] == 250
    assert body["diagnostics"]["annualizationFactor"] == 252
    assert body["diagnostics"]["stressCorrelation"] == 0.9
    assert len(body["diagnostics"]["forecasts"]) == 1
    assert body["diagnostics"]["historicalCrashWeeks"]


def test_rebalance_risk_uses_the_same_deterministic_engine_without_solving_weights() -> None:
    request = portfolio_risk_request()
    request["calculationType"] = "portfolio-risk-rebalance"
    response = client.post("/v1/calculations/run", json=request)
    assert response.status_code == 200
    assert response.json()["calculationType"] == "portfolio-risk-rebalance"
    assert response.json()["output"]["instruments"][0]["weight"] == 1.0


def test_portfolio_risk_calculation_rejects_an_incomplete_window() -> None:
    body = portfolio_risk_request()
    body["payload"]["series"][0]["bars"] = body["payload"]["series"][0]["bars"][:59]  # type: ignore[index]
    response = client.post("/v1/calculations/run", json=body)
    assert response.status_code == 422
    assert "series.0.bars" in response.json()["detail"]
    assert "at least 60 items" in response.json()["detail"]
