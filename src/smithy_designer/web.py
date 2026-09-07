"""Web designer backend: local FastAPI server for the Smithy flow editor.

Endpoints:
    GET  /api/tools        - tool catalog (name, description, JSON schema)
    GET  /api/flow         - read the current flow document
    PUT  /api/flow         - validate and save the flow document
    POST /api/debug/start  - start a debug session for the posted flow
    POST /api/debug/step   - run the current node, pause before the next one
    POST /api/debug/resume - run without pausing until finished or error
    POST /api/debug/pause  - request a pause at the next node gate
    POST /api/debug/breakpoints - toggle a breakpoint on a node
    POST /api/debug/stop   - cancel the running session
    POST /api/debug/eval   - evaluate a REPL expression against the scope
    GET  /api/debug/state  - status, current node, variables, log, REPL history
    GET  /                 - designer UI (prebuilt bundle from ``designer-web/dist``)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from smithy.core.registry import ToolRegistry

from smithy_designer.debugger import DebugError, FlowDebugger

_FLOW_VERSION = 2


def _registry() -> ToolRegistry:
    registry = ToolRegistry()
    try:
        from smithy.windows.tools import windows_tools

        for tool in windows_tools():
            registry.register(tool)
    except ImportError:
        pass
    return registry


def _static_dir() -> Path | None:
    candidates = (
        Path(__file__).parent / "static",
        Path(__file__).resolve().parents[2] / "designer-web" / "dist",
    )
    for path in candidates:
        if (path / "index.html").is_file():
            return path
    return None


def _validate_flow(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="flow must be a JSON object")
    version = data.get("version")
    if version != _FLOW_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported flow version {version!r}, expected {_FLOW_VERSION}",
        )
    nodes = data.get("nodes")
    edges = data.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise HTTPException(status_code=400, detail="nodes/edges must be lists")
    ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str):
            raise HTTPException(status_code=400, detail="every node needs a string id")
        ids.add(str(node["id"]))
    for edge in edges:
        if not isinstance(edge, dict):
            raise HTTPException(status_code=400, detail="every edge must be an object")
        if edge.get("source") not in ids or edge.get("target") not in ids:
            raise HTTPException(
                status_code=400,
                detail=f"edge {edge.get('id')!r} references unknown node",
            )
    return data


def create_app(flow_path: Path) -> FastAPI:
    """Build the designer app bound to a single flow file."""
    app = FastAPI(title="smithy-designer", docs_url=None, redoc_url=None)
    registry = _registry()
    debugger = FlowDebugger(registry)

    @app.get("/api/tools")
    def tools() -> dict[str, list[dict[str, Any]]]:
        catalog = []
        for name in registry.list_tools():
            tool = registry.get(name)
            assert tool is not None
            catalog.append(
                {
                    "name": tool.name,
                    "description": tool.description,
                    "schema": tool.schema(),
                }
            )
        return {"tools": catalog}

    @app.get("/api/flow")
    def read_flow() -> dict[str, Any]:
        if not flow_path.is_file():
            return {"exists": False, "flow": None}
        try:
            raw: Any = json.loads(flow_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"invalid JSON: {exc}") from exc
        return {"exists": True, "flow": raw}

    @app.put("/api/flow")
    async def write_flow(request: Request) -> dict[str, str]:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001 - fastapi wraps any parse error
            raise HTTPException(status_code=400, detail="body is not valid JSON") from exc
        _validate_flow(data)
        flow_path.parent.mkdir(parents=True, exist_ok=True)
        flow_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return {"status": "saved", "path": str(flow_path)}

    # -- debugging ---------------------------------------------------------

    @app.post("/api/debug/start")
    async def debug_start(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001 - fastapi wraps any parse error
            raise HTTPException(status_code=400, detail="body is not valid JSON") from exc
        _validate_flow(data)
        try:
            return debugger.start(data)
        except DebugError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/debug/step")
    async def debug_step() -> dict[str, Any]:
        debugger.step()
        return debugger.state()

    @app.post("/api/debug/resume")
    async def debug_resume() -> dict[str, Any]:
        debugger.resume()
        return debugger.state()

    @app.post("/api/debug/pause")
    async def debug_pause() -> dict[str, Any]:
        debugger.pause()
        return debugger.state()

    @app.post("/api/debug/breakpoints")
    async def debug_breakpoints(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001 - fastapi wraps any parse error
            raise HTTPException(status_code=400, detail="body is not valid JSON") from exc
        node_id = data.get("node_id") if isinstance(data, dict) else None
        enabled = data.get("enabled") if isinstance(data, dict) else None
        if not isinstance(node_id, str) or not node_id:
            raise HTTPException(status_code=400, detail="node_id must be a non-empty string")
        if not isinstance(enabled, bool):
            raise HTTPException(status_code=400, detail="enabled must be a boolean")
        debugger.set_breakpoint(node_id, enabled)
        return debugger.state()

    @app.post("/api/debug/stop")
    async def debug_stop() -> dict[str, Any]:
        debugger.stop()
        return debugger.state()

    @app.post("/api/debug/eval")
    async def debug_eval(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001 - fastapi wraps any parse error
            raise HTTPException(status_code=400, detail="body is not valid JSON") from exc
        expression = data.get("expression") if isinstance(data, dict) else None
        if not isinstance(expression, str) or not expression.strip():
            raise HTTPException(status_code=400, detail="expression must be a non-empty string")
        return debugger.eval(expression)

    @app.get("/api/debug/state")
    def debug_state() -> dict[str, Any]:
        return debugger.state()

    static = _static_dir()
    if static is not None:
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index() -> FileResponse:
            return FileResponse(static / "index.html")
    else:

        @app.get("/", include_in_schema=False)
        def no_bundle() -> PlainTextResponse:
            return PlainTextResponse(
                "Designer bundle not built yet.\n"
                "Run:  cd designer-web && npm install && npm run build\n"
                "Then restart python -m smithy_designer"
            )

    return app
