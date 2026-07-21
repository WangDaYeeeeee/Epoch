from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


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
