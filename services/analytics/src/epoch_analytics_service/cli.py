from __future__ import annotations

import argparse
import json
from pathlib import Path

import uvicorn

from epoch_analytics.contract_check import run_contract_check
from epoch_analytics.contracts import CalculationRequest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="epoch-analytics")
    subparsers = parser.add_subparsers(dest="command", required=True)

    serve = subparsers.add_parser("serve", help="start the internal HTTP service")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", default=8000, type=int)
    serve.add_argument("--reload", action="store_true")

    check = subparsers.add_parser("contract-check", help="replay a contract-check request")
    check.add_argument("input", type=Path)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "serve":
        uvicorn.run("epoch_analytics_service.api:app", host=args.host, port=args.port, reload=args.reload)
        return

    request = CalculationRequest.model_validate_json(args.input.read_text(encoding="utf-8"))
    response = run_contract_check(request)
    print(json.dumps(response.model_dump(mode="json", by_alias=True), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
