"""Web designer backend: local FastAPI server for the SmithCore flow editor.

The designer edits a **flow project**: a main flow file (``flow.json`` by
default) plus reusable subflows under ``flows/``. The canvas opens one file
at a time; a ``flow`` node references another file and can be opened.

Endpoints:
    GET  /api/tools        - tool catalog (name, description, JSON schema)
    GET  /api/flows        - flow files of the project (main + subflows)
    GET  /api/flow         - read one flow document (``?path=``, default main)
    PUT  /api/flow         - validate and save one flow document
    POST /api/flows        - create a new subflow file (starter document)
    POST /api/publish      - build a pack from the project and push it
    POST /api/record/start - start recording desktop actions (clicks + typing)
    POST /api/record/stop  - stop recording and return the captured flow-v2 document
    GET  /api/record/state - recorder status (active, step count, error)
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

import asyncio
import json
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from smithcore.core.registry import ToolRegistry
from smithcore.flow import validate_document

from smithcore_designer.capture import CaptureError
from smithcore_designer.capture import capture_selector as _capture_selector
from smithcore_designer.debugger import DebugError, FlowDebugger
from smithcore_designer.publish import publish as publish_flow
from smithcore_designer.record import RecordError, RecordSession

_FLOW_VERSION = 2
_MAX_BODY_BYTES = 1_000_000
_SUBFLOW_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_MAX_NODES = 2000
_MAX_EDGES = 4000
_MAX_CONFIG_BYTES = 200_000
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


def _check_publish_fields(url: str, name: str, version: str, *, allow_insecure: bool) -> str:
    """Validate publish target; refuse cleartext http to non-loopback hosts."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="url must be an http(s) URL")
    if parsed.scheme == "http" and not allow_insecure:
        host = (parsed.hostname or "").lower()
        if host not in ("localhost", "127.0.0.1", "::1"):
            raise HTTPException(
                status_code=400,
                detail="url must use https:// (pass allow_insecure=True to override; "
                "token would travel in cleartext)",
            )
    if not _NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="invalid pack name")
    if not _VERSION_RE.match(version):
        raise HTTPException(status_code=400, detail="invalid pack version")
    return url.rstrip("/")


async def _read_json(request: Request, max_bytes: int = _MAX_BODY_BYTES) -> Any:
    """Read the request body with a hard size cap (rejects oversized payloads)."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status_code=413, detail="request body too large")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(status_code=413, detail="request body too large")
    try:
        return json.loads(bytes(body))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="body is not valid JSON") from exc


def _registry() -> ToolRegistry:
    registry = ToolRegistry()
    try:
        from smithcore.windows.tools import windows_tools

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


def _validate_flow(data: Any, registry: ToolRegistry | None = None) -> dict[str, Any]:
    """Validate a flow-v2 document.

    Structural rules (node shapes, handles, ``on_error``, …) come from the
    engine's :func:`smithcore.flow.validate_document`; only HTTP-shape
    concerns and the designer's "one edge per handle" rule live here, so
    the editor and the runner cannot drift apart.
    """
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
    if len(nodes) > _MAX_NODES:
        raise HTTPException(
            status_code=400, detail=f"too many nodes ({len(nodes)} > {_MAX_NODES})"
        )
    if len(edges) > _MAX_EDGES:
        raise HTTPException(
            status_code=400, detail=f"too many edges ({len(edges)} > {_MAX_EDGES})"
        )
    for node in nodes:
        if isinstance(node, dict):
            try:
                size = len(json.dumps(node.get("config") or {}, ensure_ascii=False, default=str))
            except (TypeError, ValueError):
                size = 0
            if size > _MAX_CONFIG_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"node {node.get('id')!r}: config too large "
                    f"({size} > {_MAX_CONFIG_BYTES})",
                )

    problems = validate_document(data)

    # The engine follows the first edge per handle; the editor keeps exactly
    # one so a saved flow never depends on edge order.
    seen_out: dict[tuple[str, str], str] = {}
    for edge in edges:
        if not isinstance(edge, dict) or not isinstance(edge.get("source"), str):
            continue
        source = str(edge["source"])
        handle = str(edge.get("source_handle") or "")
        key = (source, handle)
        if key in seen_out:
            problems.append(
                f"node {source!r} handle {handle!r} has multiple outgoing "
                f"edges ({seen_out[key]} and {edge.get('id')!r}) — keep exactly one"
            )
        else:
            seen_out[key] = str(edge.get("id"))

    # Tool-registry checks: validate_document only does them when handed a
    # registry, and the designer catalog is exactly that registry. Skip an
    # empty registry (non-Windows host) so tools are not all "missing".
    if registry is not None:
        known = set(registry.list_tools())
        if known:
            for node in nodes:
                if not isinstance(node, dict) or node.get("kind") != "tool":
                    continue
                tool = node.get("tool")
                if isinstance(tool, str) and tool and tool not in known:
                    problems.append(f"node {node.get('id')!r}: tool {tool!r} is not registered")

    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))
    return data


def _starter_subflow() -> dict[str, Any]:
    return {
        "version": 2,
        "nodes": [
            {"id": "start", "kind": "start", "config": {}, "position": [120, 120]},
            {"id": "end", "kind": "end", "config": {}, "position": [360, 120]},
        ],
        "edges": [{"id": "e1", "source": "start", "source_handle": "out", "target": "end"}],
    }


def create_app(flow_path: Path) -> FastAPI:
    """Build the designer app bound to a flow project (one main flow file)."""
    app = FastAPI(title="smithcore-designer", docs_url=None, redoc_url=None)
    registry = _registry()
    debugger = FlowDebugger(registry)
    recorder = RecordSession()

    main_path = flow_path.resolve()
    root = main_path.parent
    main_rel = main_path.name

    def flow_list() -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = [
            {"path": main_rel, "name": main_path.name, "is_main": True}
        ]
        subdir = root / "flows"
        if subdir.is_dir():
            for path in sorted(subdir.glob("*.json")):
                if path.is_file():
                    entries.append(
                        {
                            "path": path.relative_to(root).as_posix(),
                            "name": path.name,
                            "is_main": False,
                        }
                    )
        return entries

    def resolve_flow(rel: str | None) -> Path:
        if not rel:
            return main_path
        candidate = (root / rel).resolve()
        if not candidate.is_relative_to(root) or candidate.suffix.lower() != ".json":
            raise HTTPException(status_code=400, detail="invalid flow path")
        return candidate

    def rel_of(target: Path) -> str:
        return target.relative_to(root).as_posix() if target.is_relative_to(root) else target.name

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

    @app.get("/api/flows")
    def list_flows() -> dict[str, list[dict[str, Any]]]:
        return {"flows": flow_list()}

    @app.get("/api/flow")
    def read_flow(path: str | None = None) -> dict[str, Any]:
        target = resolve_flow(path)
        if not target.is_file():
            return {"exists": False, "flow": None, "path": rel_of(target)}
        try:
            raw: Any = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"invalid JSON: {exc}") from exc
        return {"exists": True, "flow": raw, "path": rel_of(target)}

    @app.put("/api/flow")
    async def write_flow(request: Request, path: str | None = None) -> dict[str, str]:
        data = await _read_json(request)
        _validate_flow(data, registry)
        target = resolve_flow(path)
        payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

        def _write() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(payload, encoding="utf-8")

        await asyncio.to_thread(_write)
        return {"status": "saved", "path": rel_of(target)}

    @app.post("/api/flows")
    async def create_flow(request: Request) -> dict[str, str]:
        data = await _read_json(request)
        raw = str(data.get("name") if isinstance(data, dict) else "").strip()
        if raw.endswith(".json"):
            raw = raw[: -len(".json")]
        if not _SUBFLOW_NAME_RE.match(raw):
            raise HTTPException(
                status_code=400,
                detail="subflow name must be alphanumeric (letters, digits, . _ -)",
            )
        target = (root / "flows" / f"{raw}.json").resolve()
        if not target.is_relative_to(root):
            raise HTTPException(status_code=400, detail="invalid subflow name")
        if target.exists():
            raise HTTPException(status_code=409, detail=f"subflow {raw}.json already exists")
        payload = json.dumps(_starter_subflow(), ensure_ascii=False, indent=2) + "\n"

        def _write_starter() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(payload, encoding="utf-8")

        await asyncio.to_thread(_write_starter)
        return {"path": rel_of(target), "name": f"{raw}.json"}

    @app.post("/api/publish")
    async def publish_endpoint(request: Request) -> dict[str, Any]:
        data = await _read_json(request)
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="publish payload must be an object")
        url = data.get("url")
        token = data.get("token")
        name = data.get("name")
        version = data.get("version")
        if not isinstance(url, str) or not url.strip():
            raise HTTPException(status_code=400, detail="url must be a non-empty string")
        if not isinstance(token, str) or not token.strip():
            raise HTTPException(status_code=400, detail="token must be a non-empty string")
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=400, detail="name must be a non-empty string")
        if not isinstance(version, str) or not version.strip():
            raise HTTPException(status_code=400, detail="version must be a non-empty string")
        allow_insecure = bool(data.get("allow_insecure"))
        _check_publish_fields(url, name, version, allow_insecure=allow_insecure)
        try:
            import functools

            call = functools.partial(
                publish_flow,
                root,
                url,
                token,
                name,
                version,
                entry={"process": main_rel},
                allow_insecure=allow_insecure,
            )
            return await asyncio.to_thread(call)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"publish failed: {exc}") from exc

    # -- recording ---------------------------------------------------------

    @app.post("/api/record/start")
    async def record_start() -> dict[str, Any]:
        try:
            recorder.start()
        except RecordError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return recorder.state()

    @app.post("/api/record/stop")
    async def record_stop() -> dict[str, Any]:
        try:
            flow = await asyncio.to_thread(recorder.stop)
        except RecordError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"flow": flow}

    @app.get("/api/record/state")
    async def record_state() -> dict[str, Any]:
        return recorder.state()

    # -- selector capture --------------------------------------------------

    @app.post("/api/capture/selector")
    async def capture_selector_endpoint() -> dict[str, Any]:
        """Interactively capture one selector (hover + CTRL; ESC cancels)."""
        try:
            return await asyncio.to_thread(_capture_selector)
        except CaptureError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    # -- debugging ---------------------------------------------------------

    @app.post("/api/debug/start")
    async def debug_start(request: Request, dev_capture: bool = False) -> dict[str, Any]:
        data = await _read_json(request)
        _validate_flow(data, registry)
        try:
            return debugger.start(data, dev_capture=dev_capture)
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
        data = await _read_json(request)
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
        data = await _read_json(request)
        expression = data.get("expression") if isinstance(data, dict) else None
        if not isinstance(expression, str) or not expression.strip():
            raise HTTPException(status_code=400, detail="expression must be a non-empty string")
        return debugger.eval(expression)

    @app.get("/api/debug/state")
    async def debug_state() -> dict[str, Any]:
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
                "Then restart python -m smithcore_designer"
            )

    return app
