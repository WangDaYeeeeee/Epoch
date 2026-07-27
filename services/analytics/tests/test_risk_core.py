from math import isclose

import pytest

from epoch_analytics.risk_core import (
    OhlcBar,
    covariance_to_correlation,
    garman_klass_volatility,
    portfolio_risk_metrics,
    sample_covariance,
    shar_daily_forecast,
    signed_semivariances,
)


def test_garman_klass_golden_sample() -> None:
    bars = [OhlcBar(open=100, high=110, low=90, close=105) for _ in range(60)]
    assert garman_klass_volatility(bars) == pytest.approx(2.2004838300550187)


def test_garman_klass_rejects_incomplete_or_invalid_bars() -> None:
    with pytest.raises(ValueError, match="requires 60 bars"):
        garman_klass_volatility([OhlcBar(open=100, high=101, low=99, close=100)])
    invalid = [OhlcBar(open=100, high=99, low=90, close=100) for _ in range(60)]
    with pytest.raises(ValueError, match="invariants"):
        garman_klass_volatility(invalid)


def test_sample_covariance_and_correlation_golden_sample() -> None:
    covariance = sample_covariance(
        [[0.01, 0.02, 0.03], [0.02, 0.04, 0.06]],
        window=3,
        annualization_factor=1,
    )
    assert covariance[0] == pytest.approx([0.0001, 0.0002])
    assert covariance[1] == pytest.approx([0.0002, 0.0004])
    correlation = covariance_to_correlation(covariance)
    assert correlation[0] == pytest.approx([1.0, 1.0])
    assert correlation[1] == pytest.approx([1.0, 1.0])


def test_portfolio_risk_rc_and_stress_golden_sample() -> None:
    metrics = portfolio_risk_metrics(
        weights=[0.6, 0.4],
        volatilities_annualized=[0.2, 0.3],
        correlation=[[1.0, 0.5], [0.5, 1.0]],
    )
    assert metrics.volatility_annualized == pytest.approx(0.20784609690826528)
    assert metrics.stress_volatility_annualized == pytest.approx(0.23392306427541512)
    assert metrics.risk_contributions == pytest.approx((0.10392304845413264, 0.10392304845413264))
    assert metrics.risk_capital_ratios == pytest.approx((0.17320508075688773, 0.25980762113533157))
    assert isclose(sum(metrics.risk_contributions), metrics.volatility_annualized, abs_tol=1e-12)


def test_zero_weight_has_no_risk_capital_ratio() -> None:
    metrics = portfolio_risk_metrics([1.0, 0.0], [0.2, 0.3], [[1.0, 0.0], [0.0, 1.0]])
    assert metrics.risk_contributions == pytest.approx((0.2, 0.0))
    assert metrics.risk_capital_ratios == (pytest.approx(0.2), None)


def test_signed_semivariance_and_shar_daily_forecast_golden_sample() -> None:
    returns = [((index % 7) - 3) / 100 for index in range(250)]
    positive, negative, signed_jump = signed_semivariances(returns, window=22)
    assert positive + negative == pytest.approx(sum(value * value for value in returns[-22:]))
    assert signed_jump == pytest.approx(positive - negative)
    forecast = shar_daily_forecast(returns)
    assert forecast.variance_daily > 0
    assert forecast.volatility_annualized > 0
    assert len(forecast.coefficients) == 5
    assert len(forecast.har_coefficients) == 4
    assert forecast.fitted_rmse >= 0
    assert forecast.backtest_observations == 60
    assert forecast.backtest_rmse >= 0
    assert forecast.har_backtest_rmse >= 0
