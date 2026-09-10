"""Run the Smithy web designer: smithy-designer [flow.json]."""

from __future__ import annotations

import argparse
import threading
import webbrowser
from collections.abc import Sequence
from pathlib import Path

import uvicorn

from smithy_designer.web import create_app

DEFAULT_PORT = 8756


def main(argv: Sequence[str] | None = None) -> None:
    """Serve the designer UI and flow API for a single flow file."""
    parser = argparse.ArgumentParser(prog="smithy-designer", description=__doc__)
    parser.add_argument(
        "flow",
        nargs="?",
        default="flow.json",
        help="main flow file of the project (default: flow.json)",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="do not open browser")
    args = parser.parse_args(argv)

    flow_path = Path(args.flow).resolve()
    app = create_app(flow_path)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Smithy designer: {url}  (flow: {flow_path})")
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
