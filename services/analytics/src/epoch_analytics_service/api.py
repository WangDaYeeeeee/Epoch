from fastapi import FastAPI, HTTPException

from epoch_analytics.contract_check import ENGINE_VERSION, run_contract_check
from epoch_analytics.contracts import CalculationRequest, CalculationResponse

app = FastAPI(title="Epoch Analytics", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "epoch-analytics", "version": ENGINE_VERSION}


@app.post("/v1/calculations/run", response_model=CalculationResponse, response_model_by_alias=True)
def run_calculation(request: CalculationRequest) -> CalculationResponse:
    if request.calculation_type != "contract-check":
        raise HTTPException(status_code=501, detail=f"Unsupported calculation type: {request.calculation_type}")
    return run_contract_check(request)
