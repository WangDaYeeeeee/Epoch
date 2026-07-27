import json
from datetime import date, timedelta
from pathlib import Path

from jsonschema import Draft202012Validator
from pydantic import ValidationError
import pytest

from epoch_analytics.contracts import PortfolioRiskOutput

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


def test_portfolio_market_input_fixture_matches_shared_schema() -> None:
    payload = {
        "schemaVersion": "portfolio-market-input/1.0",
        "asOf": "2026-07-23T01:00:00Z",
        "baseCurrency": "USD",
        "calendar": ".NDX",
        "returnDefinition": {
            "unit": "decimal",
            "method": "close_to_close_price_return_usd",
            "priceAdjustment": "split_adjusted",
            "dividendTreatment": "excluded",
            "fxAlignment": "same_effective_date_close",
        },
        "missingValuePolicy": "intersection_only",
        "positions": [
            {"instrumentId": "US:GOOGL", "quantity": "35", "marketValueUsd": "12136.95"},
        ],
        "series": [
            {
                "instrumentId": "US:GOOGL",
                "sourceCurrency": "USD",
                "observations": [
                    {"date": "2026-07-21", "returnUsd": 0.01, "sourceObservedAt": "2026-07-23T01:00:00Z"},
                    {"date": "2026-07-22", "returnUsd": -0.005, "sourceObservedAt": "2026-07-23T01:00:00Z"},
                ],
                "missingDates": [],
            },
        ],
        "quality": {
            "status": "complete",
            "commonDateFrom": "2026-07-21",
            "commonDateTo": "2026-07-22",
            "warnings": [],
        },
    }
    Draft202012Validator(load_schema("portfolio-market-input.schema.json")).validate(payload)


def test_portfolio_risk_input_fixture_matches_shared_schema() -> None:
    start = date(2025, 1, 1)
    dates = [(start + timedelta(days=index)).isoformat() for index in range(250)]
    payload = {
        "schemaVersion": "portfolio-risk-input/1.0",
        "asOf": "2026-07-27T00:00:00Z",
        "baseCurrency": "USD",
        "weightDefinition": "market_value_usd_over_net_nav_cash_in_denominator",
        "marketDataDefinition": {
            "priceAdjustment": "split_adjusted",
            "ohlcCurrency": "usd_using_same_date_fx_close",
            "returnMethod": "common_date_close_to_close_usd",
            "dividendTreatment": "excluded",
        },
        "positions": [{"instrumentId": "US:GOOGL", "weight": 1.0}],
        "series": [{
            "instrumentId": "US:GOOGL",
            "bars": [
                {"date": value, "open": 100, "high": 101, "low": 99, "close": 100}
                for value in dates[-60:]
            ],
            "returnsUsd": [{"date": value, "value": 0.001} for value in dates],
        }],
    }
    Draft202012Validator(load_schema("portfolio-risk-input.schema.json")).validate(payload)


def risk_output_fixture() -> dict[str, object]:
    return {
        "schemaVersion": "portfolio-risk-output/1.0",
        "asOf": "2026-07-23T01:00:00Z",
        "baseCurrency": "USD",
        "estimator": {
            "id": "garman-klass-fallback",
            "version": "1.0.0",
            "status": "degraded",
            "volatilityMethod": "garman_klass_60d",
            "covarianceMethod": "sample_250d",
            "windowTradingDays": 60,
            "annualizationFactor": 252,
        },
        "portfolio": {
            "volatilityAnnualized": 0.31,
            "stressVolatilityAnnualized": 0.42,
            "historicalCvarLoss": 0.037,
            "cvarConfidence": 0.95,
            "units": {
                "volatility": "annualized_decimal",
                "cvar": "portfolio_value_decimal_loss",
            },
        },
        "instruments": [
            {
                "instrumentId": "US:GOOGL",
                "weight": 1.0,
                "volatilityAnnualized": 0.31,
                "riskContribution": 0.31,
                "riskCapitalRatio": 0.31,
            },
        ],
        "correlation": {
            "windowTradingDays": 250,
            "instrumentOrder": ["US:GOOGL"],
            "matrix": [[1.0]],
        },
        "policyGate": {
            "gateId": "portfolio_volatility_cap",
            "limitAnnualized": 0.45,
            "observedAnnualized": 0.31,
            "passed": True,
            "violations": [],
        },
        "quality": {
            "status": "degraded",
            "missingInstrumentIds": [],
            "warnings": ["SHAR-IV-J unavailable; using the 60-day fallback estimator."],
        },
    }


def test_portfolio_risk_output_fixture_matches_shared_schema_and_python_model() -> None:
    payload = risk_output_fixture()
    Draft202012Validator(load_schema("portfolio-risk-output.schema.json")).validate(payload)
    assert PortfolioRiskOutput.model_validate(payload).policy_gate.passed is True


def test_portfolio_risk_output_rejects_an_unversioned_unit_and_extra_weight_target() -> None:
    payload = risk_output_fixture()
    payload["portfolio"]["units"]["volatility"] = "percent"  # type: ignore[index]
    payload["targetWeights"] = {"US:GOOGL": 1.0}
    errors = list(Draft202012Validator(load_schema("portfolio-risk-output.schema.json")).iter_errors(payload))
    assert {error.json_path for error in errors} == {"$", "$.portfolio.units.volatility"}


def test_portfolio_risk_output_rejects_inconsistent_gate_and_correlation_semantics() -> None:
    payload = risk_output_fixture()
    payload["policyGate"]["passed"] = False  # type: ignore[index]
    payload["correlation"]["matrix"] = [[0.9]]  # type: ignore[index]
    with pytest.raises(ValidationError) as error:
        PortfolioRiskOutput.model_validate(payload)
    messages = {item["msg"] for item in error.value.errors()}
    assert "Value error, policy gate decision is inconsistent with the observed volatility" in messages
    assert "Value error, correlation matrix diagonal must equal 1" in messages
