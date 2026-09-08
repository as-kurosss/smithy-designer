"""Designer spike: interactive node canvas in the terminal.

Run:  python -m smithy_designer.tui   (Windows Terminal recommended)

Controls:
    mouse drag - move a node
    Tab        - cycle selection
    arrows     - move selected node (Shift = faster)
    q          - quit
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widget import Widget
from textual.widgets import Footer, Header

if TYPE_CHECKING:
    from textual.events import Key, MouseDown, MouseMove, MouseUp

CANVAS_W = 140
CANVAS_H = 46

Grid = list[list[tuple[str, str]]]

ARMS: dict[str, frozenset[str]] = {
    "─": frozenset("ew"),
    "│": frozenset("ns"),
    "┌": frozenset("se"),
    "┐": frozenset("sw"),
    "└": frozenset("ne"),
    "┘": frozenset("nw"),
    "┬": frozenset("sew"),
    "┴": frozenset("new"),
    "├": frozenset("nse"),
    "┤": frozenset("nsw"),
    "┼": frozenset("nsew"),
}
MERGE = {v: k for k, v in ARMS.items()}


@dataclass
class Node:
    """One block on the canvas."""

    node_id: str
    title: str
    x: int
    y: int
    color: str = "cyan"

    @property
    def w(self) -> int:
        return 17

    @property
    def h(self) -> int:
        return 5


@dataclass
class Edge:
    src: str
    dst: str


class NodeCanvas(Widget):
    """Character-grid canvas with draggable nodes and orthogonal edges."""

    DEFAULT_CSS = """
    NodeCanvas { width: 1fr; height: 1fr; }
    """

    can_focus = True

    def __init__(self) -> None:
        super().__init__()
        self.nodes: list[Node] = [
            Node("start", "start", 4, 4, "green"),
            Node("n1", "win.click", 36, 6),
            Node("if1", "res == ok?", 70, 12, "magenta"),
            Node("n2", "win.type", 36, 24),
            Node("end", "end", 106, 32, "red"),
        ]
        self.edges: list[Edge] = [
            Edge("start", "n1"),
            Edge("n1", "if1"),
            Edge("if1", "n2"),
            Edge("n2", "n1"),
            Edge("if1", "end"),
        ]
        self.selected: str = "n1"
        self._drag: tuple[str, int, int] | None = None

    def node(self, node_id: str) -> Node:
        return next(n for n in self.nodes if n.node_id == node_id)

    def _hit(self, x: int, y: int) -> Node | None:
        for n in reversed(self.nodes):
            if n.x <= x < n.x + n.w and n.y <= y < n.y + n.h:
                return n
        return None

    # -- drawing ---------------------------------------------------------

    def _put(self, g: Grid, x: int, y: int, ch: str, style: str = "") -> None:
        if 0 <= x < CANVAS_W and 0 <= y < CANVAS_H:
            g[y][x] = (ch, style)

    def _hline(self, g: Grid, y: int, x1: int, x2: int, style: str) -> None:
        for x in range(min(x1, x2), max(x1, x2) + 1):
            self._merge(g, x, y, frozenset("ew"), style)

    def _vline(self, g: Grid, x: int, y1: int, y2: int, style: str) -> None:
        for y in range(min(y1, y2), max(y1, y2) + 1):
            self._merge(g, x, y, frozenset("ns"), style)

    def _merge(self, g: Grid, x: int, y: int, arms: frozenset[str], style: str) -> None:
        if not (0 <= x < CANVAS_W and 0 <= y < CANVAS_H):
            return
        cur_ch, _ = g[y][x]
        merged = frozenset(set(ARMS.get(cur_ch, frozenset())) | set(arms))
        ch = MERGE.get(merged, " ")
        if ch != " ":
            g[y][x] = (ch, style)

    def _draw_edge(self, g: Grid, e: Edge) -> None:
        a, b = self.node(e.src), self.node(e.dst)
        ax, ay = a.x + a.w, a.y + a.h // 2
        bx, by = b.x - 1, b.y + b.h // 2
        mx = (ax + bx) // 2
        self._hline(g, ay, ax, mx, "grey62")
        self._vline(g, mx, ay, by, "grey62")
        self._hline(g, by, mx, bx, "grey62")

    def _draw_node(self, g: Grid, n: Node) -> None:
        sel = n.node_id == self.selected
        border = "bold yellow" if sel else f"bold {n.color}"
        inner = "bold white on grey15" if sel else "white"
        x, y, w, h = n.x, n.y, n.w, n.h
        for i in range(1, w - 1):
            self._put(g, x + i, y, "─", border)
            self._put(g, x + i, y + h - 1, "─", border)
        for j in range(1, h - 1):
            self._put(g, x, y + j, "│", border)
            self._put(g, x + w - 1, y + j, "│", border)
        self._put(g, x, y, "┌", border)
        self._put(g, x + w - 1, y, "┐", border)
        self._put(g, x, y + h - 1, "└", border)
        self._put(g, x + w - 1, y + h - 1, "┘", border)
        self._put_text(g, x + 1, y + 1, n.title[: w - 2], inner, w - 2)
        self._put_text(g, x + 1, y + 2, f"[{n.node_id}]", "dim", w - 2)

    def _put_text(self, g: Grid, x: int, y: int, text: str, style: str, width: int) -> None:
        padded = text.center(width)[:width]
        for i, ch in enumerate(padded):
            if ch != " ":
                self._put(g, x + i, y, ch, style)

    def render(self) -> Text:
        g: list[list[tuple[str, str]]] = [
            [(" ", "") for _ in range(CANVAS_W)] for _ in range(CANVAS_H)
        ]
        for e in self.edges:
            self._draw_edge(g, e)
        for n in self.nodes:
            self._draw_node(g, n)
        out = Text()
        for row_i, row in enumerate(g):
            run, style = "", ""
            for ch, st in row:
                if st != style:
                    out.append(run, style)
                    run, style = ch, st
                else:
                    run += ch
            out.append(run, style)
            if row_i < CANVAS_H - 1:
                out.append("\n")
        return out

    # -- interaction -----------------------------------------------------

    def on_mouse_down(self, event: MouseDown) -> None:
        hit = self._hit(event.x, event.y)
        if hit is not None:
            self.selected = hit.node_id
            self._drag = (hit.node_id, event.x - hit.x, event.y - hit.y)
            self.capture_mouse()
        self.refresh()

    def on_mouse_move(self, event: MouseMove) -> None:
        if self._drag is None:
            return
        n = self.node(self._drag[0])
        n.x = max(0, min(CANVAS_W - n.w, event.x - self._drag[1]))
        n.y = max(0, min(CANVAS_H - n.h, event.y - self._drag[2]))
        self.refresh()

    def on_mouse_up(self, event: MouseUp) -> None:
        if self._drag is not None:
            self._drag = None
            self.release_mouse()
            self.refresh()

    def on_key(self, event: Key) -> None:
        step = 5 if event.key in ("shift+up", "shift+down", "shift+left", "shift+right") else 1
        moves = {
            "up": (0, -step),
            "down": (0, step),
            "left": (-step, 0),
            "right": (step, 0),
        }
        if event.key == "tab":
            ids = [n.node_id for n in self.nodes]
            self.selected = ids[(ids.index(self.selected) + 1) % len(ids)]
        elif event.key in moves:
            dx, dy = moves[event.key]
            n = self.node(self.selected)
            n.x = max(0, min(CANVAS_W - n.w, n.x + dx))
            n.y = max(0, min(CANVAS_H - n.h, n.y + dy))
        else:
            return
        event.stop()
        event.prevent_default()
        self.refresh()


class DesignerSpike(App[None]):
    """Terminal designer look-and-feel prototype."""

    TITLE = "SMITHY DESIGNER (spike)"
    SUB_TITLE = "flow2.json · drag nodes with mouse · Tab/arrows · q quits"

    BINDINGS = [Binding("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield NodeCanvas()
        yield Footer()

    def on_mount(self) -> None:
        self.query_one(NodeCanvas).focus()


if __name__ == "__main__":
    DesignerSpike().run()
