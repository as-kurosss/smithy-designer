"""Step debugger for v2 flow documents.

Runs a flow graph node by node with pause/resume/step control, a variable
scope shared with a REPL evaluator, and a structured event log.

Variables:
    * a ``set`` node creates/overwrites a variable with a typed literal
      (type: auto | string | number | bool | json)
    * ``save_as`` on a tool node stores the tool result
    * ``$name`` inside tool config strings interpolates from the scope
      (a string that is exactly ``$name`` keeps the value's type)
    * the REPL can read variables and assign new ones between steps
"""

from __future__ import annotations

import ast
import asyncio
import json
import operator
import re
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from smithy.core.registry import ToolRegistry

_FLOW_VERSION = 2
_VAR_RE = re.compile(r"\$(\w+)")
_MAX_LOG = 500
_MAX_REPL = 100

_REPR_LIMIT = 2000
_LOG_LIMIT = 400


class DebugError(Exception):
    """Raised for debugger misuse or unsupported flow constructs."""


def _short(text: str, limit: int = _REPR_LIMIT) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _jsonable(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    except (TypeError, ValueError):
        return str(value)


def _interpolate(value: Any, variables: dict[str, Any]) -> Any:
    """Substitute ``$name`` in config values from the variable scope."""
    if isinstance(value, str):
        exact = _VAR_RE.fullmatch(value)
        if exact and exact.group(1) in variables:
            return variables[exact.group(1)]

        def sub(match: re.Match[str]) -> str:
            name = match.group(1)
            return str(variables[name]) if name in variables else match.group(0)

        return _VAR_RE.sub(sub, value)
    if isinstance(value, list):
        return [_interpolate(item, variables) for item in value]
    if isinstance(value, dict):
        return {key: _interpolate(item, variables) for key, item in value.items()}
    return value


def _evaluate_condition(condition: dict[str, Any], variables: dict[str, Any]) -> bool:
    var = str(condition.get("var") or "")
    op = str(condition.get("op") or "exists")
    left: Any = variables.get(var)
    right: Any = condition.get("value")
    if op == "exists":
        return left is not None
    if op == "is_empty":
        return left is None or left == "" or left == [] or left == {}
    try:
        if op == "eq":
            return bool(left == right)
        if op == "ne":
            return bool(left != right)
        if op == "contains":
            return bool(right in left)
        if op == "not_contains":
            return bool(right not in left)
        if op == "gt":
            return bool(left > right)
        if op == "lt":
            return bool(left < right)
    except TypeError as exc:
        raise DebugError(f"cannot compare {left!r} {op} {right!r}: {exc}") from exc
    raise DebugError(f"unknown operator {op!r}")


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
            kw.arg: _eval_node(kw.value, variables)
            for kw in node.keywords
            if kw.arg is not None
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
            _eval_node(key, variables) if key is not None else None: _eval_node(
                value, variables
            )
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
        return _short(repr(value))
    if isinstance(stmt, ast.Expr):
        return _short(repr(_eval_node(stmt.value, variables)))
    raise DebugError("only expressions and name assignments are supported")


def _parse_typed_value(value: Any, vtype: str) -> Any:
    """Interpret the ``set`` node value according to its declared type."""
    text = "" if value is None else str(value)
    if vtype == "string":
        return text
    if vtype == "number":
        try:
            return int(text)
        except ValueError:
            return float(text)  # ValueError propagates as a node failure
    if vtype == "bool":
        return text.strip().lower() in ("true", "1", "yes", "on")
    if vtype == "json":
        return json.loads(text)  # JSONDecodeError propagates as a node failure
    # auto: JSON literals when parseable, raw string otherwise
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return text


class FlowDebugger:
    """Runs one flow at a time with step/resume control and a shared scope."""

    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry
        self._task: asyncio.Task[None] | None = None
        self._resume = asyncio.Event()
        self._status = "idle"
        self._mode = "step"
        self._pause_requested = False
        self._current: str | None = None
        self._error: str | None = None
        self._variables: dict[str, Any] = {}
        self._loops: dict[str, dict[str, Any]] = {}
        self._breakpoints: set[str] = set()
        self._edges: list[dict[str, Any]] = []
        self._log_entries: list[dict[str, Any]] = []
        self._repl: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ API

    def start(self, doc: dict[str, Any]) -> dict[str, Any]:
        if self._task is not None and not self._task.done():
            raise DebugError("a debug session is already active — stop it first")
        if doc.get("version") != _FLOW_VERSION:
            raise DebugError(f"unsupported flow version {doc.get('version')!r}")
        nodes = doc.get("nodes") or []
        start_node = next((n for n in nodes if n.get("kind") == "start"), None)
        if start_node is None:
            raise DebugError("flow has no start node")
        self._resume = asyncio.Event()
        self._status = "paused"
        self._mode = "step"
        self._pause_requested = False
        self._current = str(start_node["id"])
        self._error = None
        self._variables = {}
        self._loops = {}
        self._breakpoints = {
            str(b) for b in (doc.get("breakpoints") or []) if isinstance(b, str)
        }
        self._edges = list(doc.get("edges") or [])
        self._log_entries = []
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
        if self._task is not None and not self._task.done():
            self._task.cancel()
            self._log("info", "debug session stopped")
        self._task = None
        self._status = "idle"
        self._current = None
        self._mode = "step"
        self._resume = asyncio.Event()
        self._breakpoints.clear()

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
        del self._repl[: -_MAX_REPL]
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

    # --------------------------------------------------------------- runner

    def _log(self, level: str, msg: str) -> None:
        self._log_entries.append(
            {"ts": time.time(), "level": level, "msg": _short(msg, _LOG_LIMIT)}
        )
        del self._log_entries[: -_MAX_LOG]

    def _next_by_handle(self, node_id: str, handle: str) -> str | None:
        for edge in self._edges:
            if edge.get("source") == node_id and edge.get("source_handle") == handle:
                return str(edge.get("target"))
        return None

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

    async def _run_tool(self, node: dict[str, Any]) -> None:
        name = str(node.get("tool") or "")
        if not name:
            raise DebugError("tool node has no tool name")
        config = _interpolate(dict(node.get("config") or {}), self._variables)
        self._log("info", f"▶ {name} {json.dumps(config, ensure_ascii=False, default=str)}")
        start = time.perf_counter()
        try:
            result = await self._registry.execute(name, config)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._log("error", f"✗ {name}: {type(exc).__name__}: {exc}")
            raise
        elapsed = (time.perf_counter() - start) * 1000
        rendered = json.dumps(_jsonable(result), ensure_ascii=False, default=str)
        self._log("info", f"✓ {name} ({elapsed:.0f} ms) → {_short(rendered)}")
        save_as = node.get("save_as")
        if save_as:
            self._variables[str(save_as)] = result

    def _step_loop(self, node: dict[str, Any]) -> str | None:
        node_id = str(node["id"])
        spec = dict(node.get("loop") or {})
        st = self._loops.get(node_id)
        if st is None:
            st = self._init_loop(spec)
            self._loops[node_id] = st
        if st["mode"] == "foreach":
            items = st["items"]
            if st["i"] >= len(items):
                del self._loops[node_id]
                self._log("debug", "loop exhausted → done")
                return self._next_by_handle(node_id, "done")
            var_name = str(spec.get("as") or "item")
            self._variables[var_name] = items[st["i"]]
            self._log("debug", f"loop iteration {st['i'] + 1}/{len(items)} → {var_name}")
            st["i"] += 1
            return self._next_by_handle(node_id, "body")
        if st["i"] >= int(st["max"]):
            del self._loops[node_id]
            self._log("error", f"while-loop hit max_iterations={st['max']} → done")
            return self._next_by_handle(node_id, "done")
        condition = dict(spec.get("condition") or {})
        if not _evaluate_condition(condition, self._variables):
            del self._loops[node_id]
            self._log("debug", "while condition is false → done")
            return self._next_by_handle(node_id, "done")
        st["i"] += 1
        return self._next_by_handle(node_id, "body")

    def _init_loop(self, spec: dict[str, Any]) -> dict[str, Any]:
        max_iter = int(spec.get("max_iterations") or 100)
        if str(spec.get("mode") or "foreach") == "while":
            return {"mode": "while", "i": 0, "max": max_iter}
        seq = self._variables.get(str(spec.get("var") or ""))
        if seq is None:
            raise DebugError(f"loop variable ${spec.get('var')!r} is not defined")
        try:
            items = list(seq)
        except TypeError:
            items = [seq]
        return {"mode": "foreach", "items": items, "i": 0}

    async def _execute_node(self, node: dict[str, Any]) -> str | None:
        kind = str(node.get("kind") or "")
        node_id = str(node["id"])
        if kind == "start":
            return self._next_by_handle(node_id, "out")
        if kind == "end":
            return None
        if kind == "tool":
            await self._run_tool(node)
            return self._next_by_handle(node_id, "out")
        if kind == "set":
            cfg = dict(node.get("config") or {})
            var = str(cfg.get("var") or "")
            if not var:
                raise DebugError("set node needs a variable name")
            value = _parse_typed_value(cfg.get("value"), str(cfg.get("type") or "auto"))
            self._variables[var] = value
            self._log("debug", f"set ${var} = {_short(repr(_jsonable(value)))}")
            return self._next_by_handle(node_id, "out")
        if kind == "if":
            condition = dict(node.get("condition") or {})
            branch = _evaluate_condition(condition, self._variables)
            self._log(
                "debug",
                f"if {condition.get('var')} {condition.get('op')} → {branch}",
            )
            return self._next_by_handle(node_id, "true" if branch else "false")
        if kind == "loop":
            return self._step_loop(node)
        raise DebugError(f"unknown node kind {kind!r}")

    async def _run(self, doc: dict[str, Any]) -> None:
        nodes = {str(n["id"]): n for n in doc.get("nodes") or []}
        start = next((n for n in doc.get("nodes") or [] if n.get("kind") == "start"), None)
        node: dict[str, Any] | None = start
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
                        next_id = await self._execute_node(node)
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
