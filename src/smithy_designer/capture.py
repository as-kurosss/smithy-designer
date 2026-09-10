"""Interactive selector capture for the designer UI.

Wraps the engine's single-shot capture (:func:`capture_once`): the user
hovers an element and presses CTRL, ESC cancels. ``capture_once`` blocks
(and needs the real desktop), so it is always called from a worker thread.
"""

from __future__ import annotations

from typing import Any

from smithy.windows.tools.selector_capture import CaptureCancelled, capture_once


class CaptureError(RuntimeError):
    """Raised when a capture is cancelled or the backend is unavailable."""


def capture_selector() -> dict[str, Any]:
    """Block for one interactive capture and return its ranked selector."""
    try:
        captured = capture_once()
    except CaptureCancelled as exc:
        raise CaptureError(str(exc)) from exc
    except ImportError as exc:
        raise CaptureError(f"selector capture is unavailable: {exc}") from exc
    return {
        "selector": captured.selector,
        "full_path": captured.full_path,
        "confidence": captured.confidence,
        "warnings": list(captured.warnings),
    }
