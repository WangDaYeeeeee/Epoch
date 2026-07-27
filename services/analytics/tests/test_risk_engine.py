from datetime import date, timedelta

import pytest

from epoch_analytics.contracts import PortfolioRiskInput
from epoch_analytics.risk_engine import correlation_clusters, historical_crash_weeks, historical_cvar_loss, run_portfolio_risk


def risk_input() -> PortfolioRiskInput:
    start = date(2025, 1, 1)
    dates = [(start + timedelta(days=index)).isoformat() for index in range(250)]
    bars = [
        {"date": value, "open": 100, "high": 101, "low": 99, "close": 100.5}
        for value in dates[-60:]
    ]
    return PortfolioRiskInput.model_validate({
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
        "positions": [
            {"instrumentId": "US:AAA", "weight": 0.6},
            {"instrumentId": "US:BBB", "weight": 0.4},
        ],
        "series": [
            {
                "instrumentId": "US:AAA",
                "bars": bars,
                "returnsUsd": [{"date": value, "value": (index % 5 - 2) / 100} for index, value in enumerate(dates)],
            },
            {
                "instrumentId": "US:BBB",
                "bars": bars,
                "returnsUsd": [{"date": value, "value": (index % 7 - 3) / 200} for index, value in enumerate(dates)],
            },
        ],
    })


def test_portfolio_risk_runner_produces_a_contract_valid_degraded_result() -> None:
    result = run_portfolio_risk(risk_input())
    assert result.schema_version == "portfolio-risk-output/1.0"
    assert result.estimator.volatility_method == "shar_iv_j"
    assert result.estimator.status == "degraded"
    assert result.portfolio.volatility_annualized > 0
    assert result.portfolio.stress_volatility_annualized >= result.portfolio.volatility_annualized
    assert sum(item.risk_contribution for item in result.instruments) == pytest.approx(
        result.portfolio.volatility_annualized,
    )
    assert result.policy_gate.passed is True


def test_historical_cvar_is_a_positive_loss_from_the_worst_tail() -> None:
    assert historical_cvar_loss([-0.10, -0.05, 0.01, 0.02], confidence=0.5) == pytest.approx(0.075)


def test_portfolio_volatility_above_45_percent_fails_the_only_hard_gate() -> None:
    input_data = risk_input()
    for item in input_data.series:
        for index, observation in enumerate(item.returns_usd):
            observation.value = 0.10 if index % 2 else -0.10
    result = run_portfolio_risk(input_data)
    assert result.portfolio.volatility_annualized > 0.45
    assert result.policy_gate.passed is False
    assert result.policy_gate.violations == ["PORTFOLIO_VOLATILITY_CAP_EXCEEDED"]


def test_crash_week_and_correlation_cluster_golden_samples() -> None:
    assert historical_crash_weeks(
        ["d1", "d2", "d3", "d4", "d5", "d6"],
        [0.01, -0.02, -0.03, 0.01, -0.04, 0.02],
        limit=1,
    ) == [{"endDate": "d5", "return": pytest.approx(-0.07)}]
    assert correlation_clusters(
        ["US:A", "US:B", "US:C"],
        [[1.0, 0.8, 0.2], [0.8, 1.0, 0.1], [0.2, 0.1, 1.0]],
    ) == [["US:A", "US:B"], ["US:C"]]
