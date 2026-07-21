from time import perf_counter

from epoch_analytics.contracts import CalculationRequest, CalculationResponse

ENGINE_VERSION = "epoch-analytics@0.1.0"


def run_contract_check(request: CalculationRequest) -> CalculationResponse:
    """Exercise the production contract without claiming a financial calculation."""
    started = perf_counter()
    return CalculationResponse(
        contractVersion=request.contract_version,
        calculationId=request.calculation_id,
        calculationType=request.calculation_type,
        asOf=request.as_of,
        inputHash=request.input_hash,
        engineVersion=ENGINE_VERSION,
        modelVersion="contract-check@1.0.0",
        status="succeeded",
        output={"accepted": True},
        diagnostics={"payloadKeys": sorted(request.payload)},
        durationMs=max(0, round((perf_counter() - started) * 1000)),
    )
