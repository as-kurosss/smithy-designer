"""Record → flow: drive the engine's series recorder over HTTP.

The recorder runs in a background thread inside the designer server (it
must run on the machine with the desktop). ``POST /api/record/start``
begins it, ``POST /api/record/stop`` returns a flow-v2 document built
from the captured clicks and typed text.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from smithy.windows.tools.selector_capture import nodes_to_flow, record_series

if TYPE_CHECKING:
    from smithy.windows.tools.selector_capture.generate import FlowNode


class RecordError(RuntimeError):
    """Raised for recorder misuse or a recorder-backend failure."""


class RecordSession:
    """A single in-process recording session."""

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._nodes: list[FlowNode] = []
        self._lock = threading.Lock()
        self._error: str | None = None

    @property
    def active(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        """Start recording; raises if a session is already running."""
        if self.active:
            raise RecordError("recording already in progress")
        self._stop = threading.Event()
        with self._lock:
            self._nodes = []
        self._error = None
        self._thread = threading.Thread(target=self._run, name="smithy-record", daemon=True)
        self._thread.start()

    def _record_step(self, node: FlowNode) -> None:
        with self._lock:
            self._nodes.append(node)

    def _run(self) -> None:
        try:
            record_series(self._stop, on_step=self._record_step)
        except Exception as exc:  # surfaced on stop()
            self._error = str(exc)

    def stop(self) -> dict[str, Any]:
        """Stop recording and return the captured flow-v2 document."""
        if self._thread is None:
            raise RecordError("no recording in progress")
        self._stop.set()
        self._thread.join(timeout=15)
        if self._thread.is_alive():
            raise RecordError("recorder did not stop in time")
        self._thread = None
        if self._error is not None:
            error = self._error
            self._error = None
            raise RecordError(error)
        with self._lock:
            nodes = list(self._nodes)
        return nodes_to_flow(nodes, name="recorded-flow")

    def state(self) -> dict[str, Any]:
        with self._lock:
            steps = len(self._nodes)
        return {"active": self.active, "steps": steps, "error": self._error}
