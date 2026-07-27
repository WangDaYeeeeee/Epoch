from __future__ import annotations

from math import ceil
from time import perf_counter

from epoch_analytics.contract_check import ENGINE_VERSION
from epoch_analytics.contracts import CalculationRequest, CalculationResponse, PortfolioRiskInput, PortfolioRiskOutput
from epoch_analytics.risk_core import (
    covariance_to_correlation,
    portfolio_risk_metrics,
    sample_covariance,
    shar_daily_forecast,
)

MODEL_VERSION = "portfolio-risk-shar-daily-j-no-iv@1.0.0"
PORTFOLIO_VOLATILITY_LIMIT = 0.45


def historical_cvar_loss(portfolio_returns: list[float], confidence: float = 0.95) -> float:
    if not portfolio_returns:
        raise ValueError("historical CVaR requires portfolio returns")
    tail_size = max(1, ceil(len(portfolio_returns) * (1 - confidence)))
    worst_returns = sorted(portfolio_returns)[:tail_size]
    return max(0.0, -sum(worst_returns) / tail_size)


def historical_crash_weeks(dates: list[str], portfolio_returns: list[float], limit: int = 5) -> list[dict[str, float | str]]:
    if len(dates) != len(portfolio_returns):
        raise ValueError("crash-week dates and returns must be aligned")
    weeks = [
        {"endDate": dates[index], "return": sum(portfolio_returns[index - 4:index + 1])}
        for index in range(4, len(portfolio_returns))
    ]
    return sorted(weeks, key=lambda item: item["return"])[:limit]


def correlation_clusters(
    instrument_ids: list[str],
    correlation: list[list[float]],
    threshold: float = 0.70,
) -> list[list[str]]:
    remaining = set(range(len(instrument_ids)))
    clusters: list[list[str]] = []
    while remaining:
        seed = min(remaining)
        component = {seed}
        frontier = [seed]
        remaining.remove(seed)
        while frontier:
            current = frontier.pop()
            connected = {candidate for candidate in remaining if correlation[current][candidate] >= threshold}
            component.update(connected)
            remaining.difference_update(connected)
            frontier.extend(sorted(connected))
        clusters.append([instrument_ids[index] for index in sorted(component)])
    return clusters


def run_portfolio_risk(input_data: PortfolioRiskInput) -> PortfolioRiskOutput:
    weights = [position.weight for position in input_data.positions]
    aligned_returns = [[observation.value for observation in item.returns_usd[-250:]] for item in input_data.series]
    covariance = sample_covariance(aligned_returns)
    correlation = covariance_to_correlation(covariance)
    forecasts = [shar_daily_forecast(series) for series in aligned_returns]
    volatilities = [forecast.volatility_annualized for forecast in forecasts]
    metrics = portfolio_risk_metrics(weights, volatilities, correlation)
    portfolio_returns = [
        sum(weights[instrument] * aligned_returns[instrument][day] for instrument in range(len(weights)))
        for day in range(250)
    ]
    gate_passed = metrics.volatility_annualized <= PORTFOLIO_VOLATILITY_LIMIT
    return PortfolioRiskOutput.model_validate({
        "schemaVersion": "portfolio-risk-output/1.0",
        "asOf": input_data.as_of,
        "baseCurrency": "USD",
        "estimator": {
            "id": "shar-daily-j-no-iv",
            "version": MODEL_VERSION,
            "status": "degraded",
            "volatilityMethod": "shar_iv_j",
            "covarianceMethod": "sample_250d",
            "windowTradingDays": 250,
            "annualizationFactor": 252,
        },
        "portfolio": {
            "volatilityAnnualized": metrics.volatility_annualized,
            "stressVolatilityAnnualized": metrics.stress_volatility_annualized,
            "historicalCvarLoss": historical_cvar_loss(portfolio_returns),
            "cvarConfidence": 0.95,
            "units": {
                "volatility": "annualized_decimal",
                "cvar": "portfolio_value_decimal_loss",
            },
        },
        "instruments": [
            {
                "instrumentId": position.instrument_id,
                "weight": position.weight,
                "volatilityAnnualized": volatilities[index],
                "riskContribution": metrics.risk_contributions[index],
                "riskCapitalRatio": metrics.risk_capital_ratios[index],
            }
            for index, position in enumerate(input_data.positions)
        ],
        "correlation": {
            "windowTradingDays": 250,
            "instrumentOrder": [position.instrument_id for position in input_data.positions],
            "matrix": correlation,
        },
        "policyGate": {
            "gateId": "portfolio_volatility_cap",
            "limitAnnualized": PORTFOLIO_VOLATILITY_LIMIT,
            "observedAnnualized": metrics.volatility_annualized,
            "passed": gate_passed,
            "violations": [] if gate_passed else ["PORTFOLIO_VOLATILITY_CAP_EXCEEDED"],
        },
        "quality": {
            "status": "degraded",
            "missingInstrumentIds": [],
            "warnings": [
                "SHAR signed-jump model uses the documented daily-return semivariance approximation.",
                "IV input is unavailable; beta_iv is omitted and the estimator remains degraded.",
            ],
        },
    })


def run_portfolio_risk_calculation(request: CalculationRequest, input_data: PortfolioRiskInput) -> CalculationResponse:
    started = perf_counter()
    output = run_portfolio_risk(input_data)
    aligned_returns = [[observation.value for observation in item.returns_usd[-250:]] for item in input_data.series]
    dates = [observation.date.isoformat() for observation in input_data.series[0].returns_usd[-250:]]
    forecasts = [shar_daily_forecast(series) for series in aligned_returns]
    weights = [position.weight for position in input_data.positions]
    portfolio_returns = [
        sum(weights[instrument] * aligned_returns[instrument][day] for instrument in range(len(weights)))
        for day in range(250)
    ]
    return CalculationResponse(
        contractVersion=request.contract_version,
        calculationId=request.calculation_id,
        calculationType=request.calculation_type,
        asOf=request.as_of,
        inputHash=request.input_hash,
        engineVersion=ENGINE_VERSION,
        modelVersion=MODEL_VERSION,
        status="degraded",
        output=output.model_dump(by_alias=True, mode="json"),
        diagnostics={
            "volatilityWindowTradingDays": 250,
            "correlationWindowTradingDays": 250,
            "annualizationFactor": 252,
            "stressCorrelation": 0.90,
            "semivarianceResolution": "daily_approximation",
            "ivInputStatus": "unavailable_omitted",
            "forecasts": [
                {
                    "instrumentId": item.instrument_id,
                    "varianceDaily": forecast.variance_daily,
                    "volatilityAnnualized": forecast.volatility_annualized,
                    "positiveSemivariance22d": forecast.positive_semivariance_22d,
                    "negativeSemivariance22d": forecast.negative_semivariance_22d,
                    "signedJump22d": forecast.signed_jump_22d,
                    "coefficients": {
                        "intercept": forecast.coefficients[0],
                        "dailyRv": forecast.coefficients[1],
                        "signedJump": forecast.coefficients[2],
                        "weeklyRv": forecast.coefficients[3],
                        "monthlyRv": forecast.coefficients[4],
                    },
                    "harBaselineCoefficients": list(forecast.har_coefficients),
                    "fittedError": {"mae": forecast.fitted_mae, "rmse": forecast.fitted_rmse},
                    "harBaselineFittedError": {
                        "mae": forecast.har_fitted_mae,
                        "rmse": forecast.har_fitted_rmse,
                    },
                    "expandingWindowBacktest": {
                        "observations": forecast.backtest_observations,
                        "mae": forecast.backtest_mae,
                        "rmse": forecast.backtest_rmse,
                    },
                    "harBaselineExpandingWindowBacktest": {
                        "observations": forecast.backtest_observations,
                        "mae": forecast.har_backtest_mae,
                        "rmse": forecast.har_backtest_rmse,
                    },
                }
                for item, forecast in zip(input_data.series, forecasts, strict=True)
            ],
            "historicalCrashWeeks": historical_crash_weeks(dates, portfolio_returns),
            "correlationClusters": correlation_clusters(
                [item.instrument_id for item in input_data.series],
                output.correlation.matrix,
            ),
            "divergence": {
                "status": "unavailable",
                "reason": "No executed target-weight/risk-contribution anchor was supplied to this calculation.",
            },
            "candidatePoolCompliance": {
                "status": "current_validated_series_only",
                "reason": "Rebalance inputs are restricted to instruments with current validated risk series.",
            },
        },
        warnings=output.quality.warnings,
        durationMs=max(0, round((perf_counter() - started) * 1000)),
    )
