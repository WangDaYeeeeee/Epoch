from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, allow_inf_nan=False)


class CalculationRequest(ContractModel):
    contract_version: Literal["1.0"] = Field(alias="contractVersion")
    calculation_id: UUID = Field(alias="calculationId")
    calculation_type: str = Field(alias="calculationType", min_length=1)
    as_of: datetime = Field(alias="asOf")
    input_hash: str = Field(alias="inputHash", pattern=r"^[a-f0-9]{64}$")
    code_version: str = Field(alias="codeVersion", min_length=1)
    strategy_version: str | None = Field(default=None, alias="strategyVersion")
    parameter_set_version: str | None = Field(default=None, alias="parameterSetVersion")
    payload: dict[str, Any]


class CalculationResponse(ContractModel):
    contract_version: Literal["1.0"] = Field(alias="contractVersion")
    calculation_id: UUID = Field(alias="calculationId")
    calculation_type: str = Field(alias="calculationType")
    as_of: datetime = Field(alias="asOf")
    input_hash: str = Field(alias="inputHash")
    engine_version: str = Field(alias="engineVersion")
    model_version: str = Field(alias="modelVersion")
    status: Literal["succeeded", "degraded", "failed"]
    output: dict[str, Any]
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    duration_ms: int = Field(alias="durationMs", ge=0)


class RiskPositionInput(ContractModel):
    instrument_id: str = Field(alias="instrumentId", pattern=r"^[^:]+:.+$")
    weight: float


class OhlcBarInput(ContractModel):
    date: date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)


class ReturnObservationInput(ContractModel):
    date: date
    value: float


class InstrumentRiskSeriesInput(ContractModel):
    instrument_id: str = Field(alias="instrumentId", pattern=r"^[^:]+:.+$")
    bars: list[OhlcBarInput] = Field(min_length=60)
    returns_usd: list[ReturnObservationInput] = Field(alias="returnsUsd", min_length=250)


class RiskMarketDataDefinition(ContractModel):
    price_adjustment: Literal["split_adjusted"] = Field(alias="priceAdjustment")
    ohlc_currency: Literal["usd_using_same_date_fx_close"] = Field(alias="ohlcCurrency")
    return_method: Literal["common_date_close_to_close_usd"] = Field(alias="returnMethod")
    dividend_treatment: Literal["excluded"] = Field(alias="dividendTreatment")


class PortfolioRiskInput(ContractModel):
    schema_version: Literal["portfolio-risk-input/1.0"] = Field(alias="schemaVersion")
    as_of: datetime = Field(alias="asOf")
    base_currency: Literal["USD"] = Field(alias="baseCurrency")
    weight_definition: Literal["market_value_usd_over_net_nav_cash_in_denominator"] = Field(alias="weightDefinition")
    market_data_definition: RiskMarketDataDefinition = Field(alias="marketDataDefinition")
    positions: list[RiskPositionInput] = Field(min_length=1)
    series: list[InstrumentRiskSeriesInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_alignment(self) -> PortfolioRiskInput:
        position_ids = [position.instrument_id for position in self.positions]
        series_ids = [item.instrument_id for item in self.series]
        if len(set(position_ids)) != len(position_ids) or len(set(series_ids)) != len(series_ids):
            raise ValueError("risk input instruments must be unique")
        if position_ids != series_ids:
            raise ValueError("positions and series must use the same instrument order")
        expected_dates = [observation.date for observation in self.series[0].returns_usd[-250:]]
        for item in self.series:
            dates = [observation.date for observation in item.returns_usd[-250:]]
            if dates != expected_dates:
                raise ValueError("the latest 250 USD returns must be date-aligned")
            if dates != sorted(dates) or len(set(dates)) != len(dates):
                raise ValueError("USD return dates must be unique and increasing")
            bar_dates = [bar.date for bar in item.bars]
            if bar_dates != sorted(bar_dates) or len(set(bar_dates)) != len(bar_dates):
                raise ValueError("OHLC bar dates must be unique and increasing")
        return self


class RiskEstimator(ContractModel):
    id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    status: Literal["full", "degraded"]
    volatility_method: Literal["shar_iv_j", "garman_klass_60d", "close_to_close_60d"] = Field(alias="volatilityMethod")
    covariance_method: Literal["sample_250d", "shrinkage_250d"] = Field(alias="covarianceMethod")
    window_trading_days: int = Field(alias="windowTradingDays", ge=2)
    annualization_factor: Literal[252] = Field(alias="annualizationFactor")


class PortfolioRiskSummary(ContractModel):
    volatility_annualized: float = Field(alias="volatilityAnnualized", ge=0)
    stress_volatility_annualized: float = Field(alias="stressVolatilityAnnualized", ge=0)
    historical_cvar_loss: float | None = Field(alias="historicalCvarLoss", ge=0)
    cvar_confidence: Literal[0.95] = Field(alias="cvarConfidence")
    units: dict[str, str]


class InstrumentRisk(ContractModel):
    instrument_id: str = Field(alias="instrumentId", pattern=r"^[^:]+:.+$")
    weight: float
    volatility_annualized: float = Field(alias="volatilityAnnualized", ge=0)
    risk_contribution: float = Field(alias="riskContribution")
    risk_capital_ratio: float | None = Field(alias="riskCapitalRatio")


class CorrelationMatrix(ContractModel):
    window_trading_days: Literal[250] = Field(alias="windowTradingDays")
    instrument_order: list[str] = Field(alias="instrumentOrder", min_length=1)
    matrix: list[list[float]] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_matrix(self) -> CorrelationMatrix:
        size = len(self.instrument_order)
        if len(set(self.instrument_order)) != size:
            raise ValueError("correlation instrumentOrder must be unique")
        if len(self.matrix) != size or any(len(row) != size for row in self.matrix):
            raise ValueError("correlation matrix dimensions must match instrumentOrder")
        for row_index, row in enumerate(self.matrix):
            if abs(row[row_index] - 1.0) > 1e-12:
                raise ValueError("correlation matrix diagonal must equal 1")
            for column_index, value in enumerate(row):
                if not -1 <= value <= 1:
                    raise ValueError("correlation values must be within [-1, 1]")
                if abs(value - self.matrix[column_index][row_index]) > 1e-12:
                    raise ValueError("correlation matrix must be symmetric")
        return self


class PortfolioVolatilityGate(ContractModel):
    gate_id: Literal["portfolio_volatility_cap"] = Field(alias="gateId")
    limit_annualized: Literal[0.45] = Field(alias="limitAnnualized")
    observed_annualized: float = Field(alias="observedAnnualized", ge=0)
    passed: bool
    violations: list[Literal["PORTFOLIO_VOLATILITY_CAP_EXCEEDED"]]

    @model_validator(mode="after")
    def validate_decision(self) -> PortfolioVolatilityGate:
        expected_passed = self.observed_annualized <= self.limit_annualized
        expected_violations = [] if expected_passed else ["PORTFOLIO_VOLATILITY_CAP_EXCEEDED"]
        if self.passed != expected_passed or self.violations != expected_violations:
            raise ValueError("policy gate decision is inconsistent with the observed volatility")
        return self


class RiskQuality(ContractModel):
    status: Literal["complete", "degraded"]
    missing_instrument_ids: list[str] = Field(alias="missingInstrumentIds")
    warnings: list[str]


class PortfolioRiskOutput(ContractModel):
    schema_version: Literal["portfolio-risk-output/1.0"] = Field(alias="schemaVersion")
    as_of: datetime = Field(alias="asOf")
    base_currency: Literal["USD"] = Field(alias="baseCurrency")
    estimator: RiskEstimator
    portfolio: PortfolioRiskSummary
    instruments: list[InstrumentRisk] = Field(min_length=1)
    correlation: CorrelationMatrix
    policy_gate: PortfolioVolatilityGate = Field(alias="policyGate")
    quality: RiskQuality

    @model_validator(mode="after")
    def validate_instrument_alignment(self) -> PortfolioRiskOutput:
        instrument_ids = [instrument.instrument_id for instrument in self.instruments]
        if len(set(instrument_ids)) != len(instrument_ids):
            raise ValueError("instrument risk rows must be unique")
        if instrument_ids != self.correlation.instrument_order:
            raise ValueError("instrument rows must use the correlation instrumentOrder")
        if abs(self.policy_gate.observed_annualized - self.portfolio.volatility_annualized) > 1e-12:
            raise ValueError("policy gate must evaluate the reported portfolio volatility")
        return self
