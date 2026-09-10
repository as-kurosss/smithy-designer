"""Step debugger for v2 flow documents.

Interactive layer on top of the engine-side :mod:`smithy.flow` executor:
runs a flow graph node by node with pause/resume/step control, breakpoints,
a variable scope shared with a REPL evaluator, and a structured event log.
All node execution (tool calls, interpolation, conditions, loops, ``set``)
is delegated to :class:`smithy.flow.FlowRunner` — the debugger only owns
the control flow: gates, retries, breakpoints and the REPL.

Variables:
    * a ``set`` node creates/overwrites a variable with a typed literal
      (type: auto | string | number | bool | json); the value may
      reference other variables (``$name``, ``$app.pid``)
    * ``save_as`` on a tool node stores the tool result
    * ``$name`` inside tool config strings interpolates from the scope;
      paths drill into saved results (``$app.pid``, ``$rows[0].name``) —
      a string that is a single reference keeps the value's type
    * ``if`` / ``loop`` conditions accept variables too: ``var`` may be a
      dotted path (``app.pid``) and ``value`` interpolates ``$refs``
    * the REPL can read variables and assign new ones between steps
"""

from __future__ import annotations

import ast
import asyncio
import time
from typing import TYPE_CHECKING, Any

from smithy.flow import (
    FLOW_VERSION,
    FlowError,
    FlowRunner,
    jsonable,
    short,
)

if TYPE_CHECKING:
    from smithy.core.registry import ToolRegistry

_MAX_LOG = 500
_MAX_REPL = 100

_LOG_LIMIT = 400


class DebugError(FlowError):
    """Raised for debugger misuse or unsupported flow constructs."""


def _jsonable(value: Any) -> Any:
    return jsonable(value)


# -- REPL sandbox (debugger-only: the flow runner never evaluates Python) --

import operator  # noqa: E402

_SAFE_FUNCS: dict[str, Any] = {
    "len": len,
    "str": str,
    "repr": repr,
    "int": int,
    "float": float,
    "bool": bool,
    "round": round,
    "abs": abs,
    "sum": sum,
    "min": min,
    "max": max,
    "sorted": sorted,
    "list": list,
    "tuple": tuple,
    "set": set,
    "dict": dict,
}
_BIN_OPS: dict[type[ast.operator], Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_CMP_OPS: dict[type[ast.cmpop], Any] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
    ast.Is: operator.is_,
    ast.IsNot: operator.is_not,
}


def _eval_node(node: ast.expr, variables: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in variables:
            return variables[node.id]
        if node.id in _SAFE_FUNCS:
            return _SAFE_FUNCS[node.id]
        raise DebugError(f"name {node.id!r} is not defined")
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        return _BIN_OPS[type(node.op)](
            _eval_node(node.left, variables), _eval_node(node.right, variables)
        )
    if isinstance(node, ast.UnaryOp):
        value = _eval_node(node.operand, variables)
        if isinstance(node.op, ast.Not):
            return not value
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.UAdd):
            return +value
    if isinstance(node, ast.BoolOp):
        result: Any = isinstance(node.op, ast.And)
        for sub in node.values:
            result = _eval_node(sub, variables)
            if isinstance(node.op, ast.And) and not result:
                return result
            if isinstance(node.op, ast.Or) and result:
                return result
        return result
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, variables)
        for op, comparator in zip(node.ops, node.comparators, strict=True):
            right = _eval_node(comparator, variables)
            fn = _CMP_OPS.get(type(op))
            if fn is None:
                raise DebugError(f"unsupported comparison {type(op).__name__}")
            if not fn(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Subscript):
        obj = _eval_node(node.value, variables)
        return obj[_eval_node(node.slice, variables)]
    if isinstance(node, ast.Slice):
        lower = _eval_node(node.lower, variables) if node.lower else None
        upper = _eval_node(node.upper, variables) if node.upper else None
        step = _eval_node(node.step, variables) if node.step else None
        return slice(lower, upper, step)
    if isinstance(node, ast.Attribute):
        obj = _eval_node(node.value, variables)
        if node.attr.startswith("_"):
            raise DebugError(f"attribute {node.attr!r} is not allowed")
        return getattr(obj, node.attr)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name):
            func: Any = _SAFE_FUNCS.get(node.func.id)
            if func is None:
                raise DebugError(f"function {node.func.id!r} is not allowed")
        elif isinstance(node.func, ast.Attribute):
            func = _eval_node(node.func, variables)
        else:
            raise DebugError("only plain and method calls are allowed")
        args = [_eval_node(arg, variables) for arg in node.args]
        kwargs = {
            kw.arg: _eval_node(kw.value, variables) for kw in node.keywords if kw.arg is not None
        }
        if any(kw.arg is None for kw in node.keywords):
            raise DebugError("**kwargs is not allowed")
        return func(*args, **kwargs)
    if isinstance(node, ast.IfExp):
        branch = node.body if _eval_node(node.test, variables) else node.orelse
        return _eval_node(branch, variables)
    if isinstance(node, ast.List):
        return [_eval_node(item, variables) for item in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval_node(item, variables) for item in node.elts)
    if isinstance(node, ast.Set):
        return {_eval_node(item, variables) for item in node.elts}
    if isinstance(node, ast.Dict):
        return {
            _eval_node(key, variables) if key is not None else None: _eval_node(value, variables)
            for key, value in zip(node.keys, node.values, strict=True)
        }
    if isinstance(node, ast.JoinedStr):
        raise DebugError("f-strings are not supported; use str(...) instead")
    raise DebugError(f"unsupported syntax: {type(node).__name__}")


def _eval_repl(expression: str, variables: dict[str, Any]) -> str:
    tree = ast.parse(expression, mode="exec")
    if len(tree.body) != 1:
        raise DebugError("exactly one expression or one assignment is allowed")
    stmt = tree.body[0]
    if isinstance(stmt, ast.Assign):
        if len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
            raise DebugError("only simple name assignment is supported (name = expr)")
        value = _eval_node(stmt.value, variables)
        variables[stmt.targets[0].id] = value
        return short(repr(value))
    if isinstance(stmt, ast.Expr):
        return short(repr(_eval_node(stmt.value, variables)))
    raise DebugError("only expressions and name assignments are supported")


class FlowDebugger:
    """Runs one flow at a time with step/resume control and a shared scope."""

    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry
        self._runner: FlowRunner | None = None
        self._task: asyncio.Task[None] | None = None
        self._resume = asyncio.Event()
        self._status = "idle"
        self._mode = "step"
        self._pause_requested = False
        self._current: str | None = None
        self._error: str | None = None
        self._variables: dict[str, Any] = {}
        self._breakpoints: set[str] = set()
        self._edges: list[dict[str, Any]] = []
        self._log_entries: list[dict[str, Any]] = []
        self._repl: list[dict[str, Any]] = []
        self._session = 0

    # ------------------------------------------------------------------ API

    def start(self, doc: dict[str, Any], *, dev_capture: bool = False) -> dict[str, Any]:
        if self._task is not None and not self._task.done():
            raise DebugError("a debug session is already active — stop it first")
        if doc.get("version") != FLOW_VERSION:
            raise DebugError(f"unsupported flow version {doc.get('version')!r}")
        start = next((n for n in doc.get("nodes") or [] if n.get("kind") == "start"), None)
        if start is None:
            raise DebugError("flow has no start node")
        self._session += 1
        self._resume = asyncio.Event()
        self._status = "paused"
        self._mode = "step"
        self._pause_requested = False
        self._current = str(start["id"])
        self._error = None
        self._variables = {}
        self._breakpoints = {str(b) for b in (doc.get("breakpoints") or []) if isinstance(b, str)}
        self._edges = list(doc.get("edges") or [])
        self._log_entries = []
        self._runner = FlowRunner(
            self._registry,
            variables=self._variables,
            edges=self._edges,
            log=self._log,
            dev_capture=dev_capture,
        )
        self._task = asyncio.get_running_loop().create_task(self._run(doc))
        return self.state()

    def step(self) -> None:
        """Run the current node and pause before the next one."""
        self._mode = "step"
        self._resume.set()

    def resume(self) -> None:
        """Run without pausing until the flow finishes or errors."""
        self._mode = "run"
        self._pause_requested = False
        self._resume.set()

    def pause(self) -> None:
        """Request a pause at the next node gate."""
        self._pause_requested = True

    def set_breakpoint(self, node_id: str, enabled: bool) -> None:
        """Toggle a breakpoint on a node for the current/next session."""
        if enabled:
            self._breakpoints.add(node_id)
        else:
            self._breakpoints.discard(node_id)

    def stop(self) -> None:
        task = self._task
        self._task = None
        if task is not None and not task.done():
            session = self._session
            task.cancel()
            # Safety net: if a new session started before the old task finished
            # cancelling, do not clobber the new session's state.
            task.add_done_callback(lambda _t: self._on_stale_task_done(session))
            self._log("info", "debug session stopped")
        self._status = "idle"
        self._current = None
        self._mode = "step"
        self._resume = asyncio.Event()
        self._breakpoints.clear()
        self._runner = None

    def _on_stale_task_done(self, session: int) -> None:
        if self._session != session:
            return
        self._task = None
        if self._status in ("running", "paused", "error"):
            self._status = "idle"
            self._current = None

    def eval(self, expression: str) -> dict[str, Any]:
        """Evaluate a REPL expression against (and mutating) the scope."""
        entry: dict[str, Any]
        try:
            entry = {
                "ts": time.time(),
                "expression": expression,
                "result": _eval_repl(expression, self._variables),
                "error": None,
            }
        except Exception as exc:  # noqa: BLE001 - REPL reports any failure
            entry = {
                "ts": time.time(),
                "expression": expression,
                "result": "",
                "error": f"{type(exc).__name__}: {exc}",
            }
        self._repl.append(entry)
        del self._repl[:-_MAX_REPL]
        return {"result": entry["result"], "error": entry["error"]}

    def state(self) -> dict[str, Any]:
        return {
            "status": self._status,
            "current_node": self._current,
            "error": self._error,
            "variables": _jsonable(self._variables),
            "log": self._log_entries,
            "repl": self._repl,
        }

    # --------------------------------------------------------------- control

    def _log(self, level: str, msg: str) -> None:
        self._log_entries.append({"ts": time.time(), "level": level, "msg": short(msg, _LOG_LIMIT)})
        del self._log_entries[:-_MAX_LOG]

    async def _wait_gate(self) -> None:
        # While a failed node awaits a retry the status stays "error".
        if self._error is not None:
            self._status = "error"
        elif self._mode == "run" and not self._pause_requested:
            self._status = "running"
        else:
            self._status = "paused"
        if self._mode == "run" and not self._pause_requested and self._error is None:
            return
        self._pause_requested = False
        self._log("debug", f"paused at node {self._current}")
        await self._resume.wait()
        self._resume.clear()

    async def _run(self, doc: dict[str, Any]) -> None:
        nodes = {str(n["id"]): n for n in doc.get("nodes") or []}
        start = next((n for n in doc.get("nodes") or [] if n.get("kind") == "start"), None)
        node: dict[str, Any] | None = start
        runner = self._runner
        assert runner is not None
        try:
            while node is not None:
                self._current = str(node["id"])
                if (
                    self._current in self._breakpoints
                    and self._error is None
                    and self._mode == "run"
                ):
                    self._pause_requested = True
                    self._log("debug", f"breakpoint hit at node {self._current}")
                while True:
                    await self._wait_gate()
                    try:
                        next_id = await runner.execute_node(node)
                        self._error = None
                        break
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # noqa: BLE001 - pause for inspection
                        self._error = f"{type(exc).__name__}: {exc}"
                        self._status = "error"
                        self._mode = "step"
                        self._resume.clear()
                        self._log("error", f"node {node['id']} failed — step to retry")
                if next_id is None:
                    self._log("info", "flow finished")
                    break
                node = nodes.get(next_id)
            self._status = "finished"
            self._current = None
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - never leave a stale status
            self._error = f"{type(exc).__name__}: {exc}"
            self._status = "error"
            self._current = None
