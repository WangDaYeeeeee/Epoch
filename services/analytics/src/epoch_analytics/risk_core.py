from __future__ import annotations

from dataclasses import dataclass
from math import log, sqrt
from statistics import fmean

ANNUALIZATION_FACTOR = 252
GARMAN_KLASS_WINDOW = 60
CORRELATION_WINDOW = 250
STRESS_CORRELATION = 0.90


@dataclass(frozen=True)
class OhlcBar:
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class PortfolioRiskMetrics:
    volatility_annualized: float
    stress_volatility_annualized: float
    risk_contributions: tuple[float, ...]
    risk_capital_ratios: tuple[float | None, ...]


@dataclass(frozen=True)
class SharForecast:
    variance_daily: float
    volatility_annualized: float
    coefficients: tuple[float, ...]
    har_coefficients: tuple[float, ...]
    positive_semivariance_22d: float
    negative_semivariance_22d: float
    signed_jump_22d: float
    fitted_mae: float
    fitted_rmse: float
    har_fitted_mae: float
    har_fitted_rmse: float
    backtest_mae: float
    backtest_rmse: float
    har_backtest_mae: float
    har_backtest_rmse: float
    backtest_observations: int


def garman_klass_volatility(
    bars: list[OhlcBar],
    *,
    window: int = GARMAN_KLASS_WINDOW,
    annualization_factor: int = ANNUALIZATION_FACTOR,
) -> float:
    """Return annualized Garman-Klass volatility from the latest complete window."""
    if window < 2:
        raise ValueError("Garman-Klass window must contain at least 2 trading days")
    if len(bars) < window:
        raise ValueError(f"Garman-Klass requires {window} bars; received {len(bars)}")
    daily_variances: list[float] = []
    for bar in bars[-window:]:
        if min(bar.open, bar.high, bar.low, bar.close) <= 0:
            raise ValueError("OHLC prices must be positive")
        if bar.high < max(bar.open, bar.low, bar.close) or bar.low > min(bar.open, bar.high, bar.close):
            raise ValueError("OHLC high/low invariants are violated")
        range_term = 0.5 * log(bar.high / bar.low) ** 2
        close_open_term = (2 * log(2) - 1) * log(bar.close / bar.open) ** 2
        daily_variances.append(max(0.0, range_term - close_open_term))
    return sqrt(fmean(daily_variances) * annualization_factor)


def sample_covariance(
    aligned_returns: list[list[float]],
    *,
    window: int = CORRELATION_WINDOW,
    annualization_factor: int = ANNUALIZATION_FACTOR,
) -> list[list[float]]:
    """Return an annualized sample covariance matrix from aligned return rows."""
    if not aligned_returns:
        raise ValueError("at least one aligned return series is required")
    if window < 2:
        raise ValueError("covariance window must contain at least 2 trading days")
    if any(len(series) < window for series in aligned_returns):
        observed = min(len(series) for series in aligned_returns)
        raise ValueError(f"sample covariance requires {window} returns per instrument; received {observed}")
    sample = [series[-window:] for series in aligned_returns]
    means = [fmean(series) for series in sample]
    denominator = window - 1
    return [
        [
            sum((left[index] - means[row]) * (right[index] - means[column]) for index in range(window))
            / denominator
            * annualization_factor
            for column, right in enumerate(sample)
        ]
        for row, left in enumerate(sample)
    ]


def signed_semivariances(returns: list[float], *, window: int = 22) -> tuple[float, float, float]:
    if window < 1 or len(returns) < window:
        raise ValueError(f"signed semivariance requires {window} returns; received {len(returns)}")
    sample = returns[-window:]
    positive = sum(value * value for value in sample if value > 0)
    negative = sum(value * value for value in sample if value < 0)
    return positive, negative, positive - negative


def _solve_ridge(features: list[list[float]], targets: list[float], ridge: float = 1e-10) -> list[float]:
    if not features or len(features) != len(targets):
        raise ValueError("regression features and targets must be non-empty and aligned")
    width = len(features[0])
    if any(len(row) != width for row in features):
        raise ValueError("regression feature rows must have equal width")
    matrix = [
        [sum(row[left] * row[right] for row in features) + (ridge if left == right and left else 0.0)
         for right in range(width)]
        for left in range(width)
    ]
    vector = [sum(row[column] * target for row, target in zip(features, targets, strict=True))
              for column in range(width)]
    augmented = [matrix[row] + [vector[row]] for row in range(width)]
    for column in range(width):
        pivot = max(range(column, width), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) <= 1e-18:
            raise ValueError("regression design matrix is singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(width):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                augmented[row][index] - factor * augmented[column][index]
                for index in range(width + 1)
            ]
    return [augmented[index][-1] for index in range(width)]


def _shar_design(returns: list[float]) -> tuple[list[list[float]], list[list[float]], list[float]]:
    rv = [value * value for value in returns]
    shar_features: list[list[float]] = []
    har_features: list[list[float]] = []
    targets: list[float] = []
    for day in range(21, len(returns) - 1):
        _, _, signed_jump = signed_semivariances(returns[:day + 1], window=22)
        daily = rv[day]
        weekly = fmean(rv[day - 4:day + 1])
        monthly = fmean(rv[day - 21:day + 1])
        shar_features.append([1.0, daily, signed_jump, weekly, monthly])
        har_features.append([1.0, daily, weekly, monthly])
        targets.append(rv[day + 1])
    return shar_features, har_features, targets


def _latest_shar_features(returns: list[float]) -> tuple[list[float], list[float]]:
    rv = [value * value for value in returns]
    _, _, signed_jump = signed_semivariances(returns, window=22)
    shar = [1.0, rv[-1], signed_jump, fmean(rv[-5:]), fmean(rv[-22:])]
    har = [1.0, rv[-1], fmean(rv[-5:]), fmean(rv[-22:])]
    return shar, har


def shar_daily_forecast(
    returns: list[float],
    *,
    annualization_factor: int = ANNUALIZATION_FACTOR,
) -> SharForecast:
    """Fit HAR-RV and SHAR signed-jump models using the documented daily approximation."""
    if len(returns) < 60:
        raise ValueError(f"SHAR daily approximation requires at least 60 returns; received {len(returns)}")
    rv = [value * value for value in returns]
    shar_features, har_features, targets = _shar_design(returns)
    coefficients = _solve_ridge(shar_features, targets)
    har_coefficients = _solve_ridge(har_features, targets)
    positive, negative, signed_jump = signed_semivariances(returns, window=22)
    latest_shar, _ = _latest_shar_features(returns)
    prediction = sum(value * coefficient for value, coefficient in zip(latest_shar, coefficients, strict=True))
    variance_floor = max(1e-12, fmean(rv[-22:]) * 0.05)
    forecast_variance = max(variance_floor, prediction)

    def errors(rows: list[list[float]], fitted_coefficients: list[float]) -> tuple[float, float]:
        residuals = [
            target - sum(value * coefficient for value, coefficient in zip(row, fitted_coefficients, strict=True))
            for row, target in zip(rows, targets, strict=True)
        ]
        return fmean(abs(value) for value in residuals), sqrt(fmean(value * value for value in residuals))

    fitted_mae, fitted_rmse = errors(shar_features, coefficients)
    har_mae, har_rmse = errors(har_features, har_coefficients)
    shar_backtest_errors: list[float] = []
    har_backtest_errors: list[float] = []
    for cutoff in range(max(60, len(returns) - 60), len(returns)):
        history = returns[:cutoff]
        rolling_shar, rolling_har, rolling_targets = _shar_design(history)
        rolling_shar_coefficients = _solve_ridge(rolling_shar, rolling_targets)
        rolling_har_coefficients = _solve_ridge(rolling_har, rolling_targets)
        shar_row, har_row = _latest_shar_features(history)
        actual = returns[cutoff] ** 2
        shar_backtest_errors.append(
            actual - max(0.0, sum(value * coefficient for value, coefficient in zip(
                shar_row, rolling_shar_coefficients, strict=True,
            ))),
        )
        har_backtest_errors.append(
            actual - max(0.0, sum(value * coefficient for value, coefficient in zip(
                har_row, rolling_har_coefficients, strict=True,
            ))),
        )

    def out_of_sample_errors(values: list[float]) -> tuple[float, float]:
        return fmean(abs(value) for value in values), sqrt(fmean(value * value for value in values))

    backtest_mae, backtest_rmse = out_of_sample_errors(shar_backtest_errors)
    har_backtest_mae, har_backtest_rmse = out_of_sample_errors(har_backtest_errors)
    return SharForecast(
        variance_daily=forecast_variance,
        volatility_annualized=sqrt(forecast_variance * annualization_factor),
        coefficients=tuple(coefficients),
        har_coefficients=tuple(har_coefficients),
        positive_semivariance_22d=positive,
        negative_semivariance_22d=negative,
        signed_jump_22d=signed_jump,
        fitted_mae=fitted_mae,
        fitted_rmse=fitted_rmse,
        har_fitted_mae=har_mae,
        har_fitted_rmse=har_rmse,
        backtest_mae=backtest_mae,
        backtest_rmse=backtest_rmse,
        har_backtest_mae=har_backtest_mae,
        har_backtest_rmse=har_backtest_rmse,
        backtest_observations=len(shar_backtest_errors),
    )


def covariance_to_correlation(covariance: list[list[float]]) -> list[list[float]]:
    size = len(covariance)
    if size == 0 or any(len(row) != size for row in covariance):
        raise ValueError("covariance matrix must be non-empty and square")
    standard_deviations = [sqrt(max(0.0, covariance[index][index])) for index in range(size)]
    return [
        [
            1.0
            if row == column
            else max(
                -1.0,
                min(1.0, covariance[row][column] / (standard_deviations[row] * standard_deviations[column])),
            )
            if standard_deviations[row] and standard_deviations[column]
            else 0.0
            for column in range(size)
        ]
        for row in range(size)
    ]


def portfolio_risk_metrics(
    weights: list[float],
    volatilities_annualized: list[float],
    correlation: list[list[float]],
    *,
    stress_correlation: float = STRESS_CORRELATION,
) -> PortfolioRiskMetrics:
    size = len(weights)
    if size == 0 or len(volatilities_annualized) != size:
        raise ValueError("weights and volatilities must be non-empty and aligned")
    if any(volatility < 0 for volatility in volatilities_annualized):
        raise ValueError("volatilities must be non-negative")
    if len(correlation) != size or any(len(row) != size for row in correlation):
        raise ValueError("correlation matrix dimensions must match weights")
    if not 0 <= stress_correlation <= 1:
        raise ValueError("stress correlation must be within [0, 1]")

    covariance = [
        [
            volatilities_annualized[row] * volatilities_annualized[column] * correlation[row][column]
            for column in range(size)
        ]
        for row in range(size)
    ]
    stress_covariance = [
        [
            volatilities_annualized[row] ** 2
            if row == column
            else volatilities_annualized[row] * volatilities_annualized[column] * stress_correlation
            for column in range(size)
        ]
        for row in range(size)
    ]

    def portfolio_volatility(matrix: list[list[float]]) -> float:
        variance = sum(
            weights[row] * matrix[row][column] * weights[column]
            for row in range(size)
            for column in range(size)
        )
        return sqrt(max(0.0, variance))

    volatility = portfolio_volatility(covariance)
    stress_volatility = portfolio_volatility(stress_covariance)
    if volatility <= 1e-15:
        contributions = tuple(0.0 for _ in weights)
    else:
        contributions = tuple(
            weights[row] * sum(covariance[row][column] * weights[column] for column in range(size)) / volatility
            for row in range(size)
        )
    capital_ratios = tuple(
        contribution / weight if abs(weight) > 1e-15 else None
        for contribution, weight in zip(contributions, weights, strict=True)
    )
    return PortfolioRiskMetrics(volatility, stress_volatility, contributions, capital_ratios)
