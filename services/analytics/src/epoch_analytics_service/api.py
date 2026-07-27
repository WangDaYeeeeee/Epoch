from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from epoch_analytics.contract_check import ENGINE_VERSION, run_contract_check
from epoch_analytics.contracts import CalculationRequest, CalculationResponse, PortfolioRiskInput
from epoch_analytics.risk_engine import run_portfolio_risk_calculation

app = FastAPI(title="Epoch Analytics", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "epoch-analytics", "version": ENGINE_VERSION}


@app.post("/v1/calculations/run", response_model=CalculationResponse, response_model_by_alias=True)
def run_calculation(request: CalculationRequest) -> CalculationResponse:
    if request.calculation_type == "contract-check":
        return run_contract_check(request)
    if request.calculation_type in {"portfolio-risk", "portfolio-risk-rebalance"}:
        try:
            input_data = PortfolioRiskInput.model_validate(request.payload)
        except ValidationError as error:
            messages = "; ".join(
                f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
                for item in error.errors()
            )
            raise HTTPException(status_code=422, detail=f"Invalid portfolio-risk payload: {messages}") from error
        return run_portfolio_risk_calculation(request, input_data)
    raise HTTPException(status_code=501, detail=f"Unsupported calculation type: {request.calculation_type}")
