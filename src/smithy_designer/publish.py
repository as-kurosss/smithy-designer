"""Publish a flow-v2 document to a smithy-cloud orchestrator as a process bundle.

The bundle contract (engine-agnostic):
    files        {"flow.json": <doc>, "main.py": <runner shim>}
    entry_point  main.py
    requirements ["smithy-engine[windows]>=0.7"]

The shim runs the flow with the engine's FlowRunner at start-up; the agent
executes it exactly like any other Python process. Later, a designer UI
button can reuse :func:`publish` — the wire format will not change.

Usage:
    python -m smithy_designer.publish flow.web.json \
        --url http://localhost:8000 --token sct_... \
        [--name my-flow] [--deploy AGENT_ID]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Sequence

RUNNER_SHIM = '''\
"""Runs the bundled flow.json with the smithy engine."""

import sys

from smithy.run_flow import main

sys.exit(main(["flow.json"]))
'''

DEFAULT_REQUIREMENTS = ["smithy-engine[windows]>=0.7"]


def _request(
    method: str,
    url: str,
    token: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode() or exc.reason
        raise SystemExit(f"orchestrator returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"cannot reach orchestrator: {exc.reason}") from exc


def publish(
    doc: dict[str, Any],
    base_url: str,
    token: str,
    name: str | None = None,
) -> dict[str, Any]:
    """Create the process bundle on the orchestrator; returns its response."""
    files = {
        "flow.json": json.dumps(doc, ensure_ascii=False, indent=2),
        "main.py": RUNNER_SHIM,
    }
    payload = {
        "name": name or "flow",
        "entry_point": "main.py",
        "files": files,
        "requirements": DEFAULT_REQUIREMENTS,
    }
    result = _request("POST", f"{base_url.rstrip('/')}/api/processes", token, payload)
    assert isinstance(result, dict)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smithy_designer.publish", description=__doc__)
    parser.add_argument("flow", help="path to a v2 flow document (JSON)")
    parser.add_argument("--url", required=True, help="orchestrator base URL")
    parser.add_argument("--token", required=True, help="API token (sct_...) or user JWT")
    parser.add_argument("--name", help="process name (default: flow file stem)")
    parser.add_argument(
        "--deploy", metavar="AGENT_ID", help="also deploy the process to this agent"
    )
    args = parser.parse_args(argv)

    doc: dict[str, Any] = json.loads(Path(args.flow).read_text(encoding="utf-8"))
    if doc.get("version") != 2:
        print(f"refusing to publish: flow version {doc.get('version')!r} is not 2", file=sys.stderr)
        return 1

    name = args.name or Path(args.flow).stem
    process = publish(doc, args.url, args.token, name=name)
    pid = str(process["id"])
    print(f"published: process {pid} ({process.get('name', name)})")

    if args.deploy:
        deployment = _request(
            "POST",
            f"{args.url.rstrip('/')}/api/processes/{pid}/deploy",
            args.token,
            {"agent_id": args.deploy},
        )
        print(f"deployed: deployment {deployment['id']} -> {deployment.get('status')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
