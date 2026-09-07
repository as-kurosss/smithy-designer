import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import { fetchFlow, fetchTools, saveFlow, debugStart, debugAction, debugState, debugEval, debugBreakpoint } from "./api";
import type { DebugState } from "./debugTypes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  FlowDoc,
  FlowEdgeDto,
  FlowNodeDto,
  NodeKind,
  SmithyFlowEdge,
  SmithyFlowNode,
  SmithyNodeData,
  ToolInfo,
} from "./types";
import SmithyNodeComponent, { NodeEditContext } from "./components/SmithyNode";
import Toolbox from "./components/Toolbox";
import Properties from "./components/Properties";
import DebugPanel from "./components/DebugPanel";

const nodeTypes = { smithy: SmithyNodeComponent };
const edgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#5b6f63" },
  style: { stroke: "#5b6f63", strokeWidth: 2 },
};
const errorEdgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#dc2626" },
  style: { stroke: "#dc2626", strokeWidth: 2 },
};

function edgeOptionsFor(sourceHandle?: string | null) {
  return sourceHandle === "error" ? errorEdgeOptions : edgeOptions;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function starterDoc(): FlowDoc {
  return {
    version: 2,
    nodes: [{ id: "start", kind: "start", config: {}, position: [120, 160] }],
    edges: [],
  };
}

function toFlowNode(n: FlowNodeDto): SmithyFlowNode {
    return {
      id: n.id,
      type: "smithy",
      position: { x: n.position?.[0] ?? 0, y: n.position?.[1] ?? 0 },
      data: {
        kind: n.kind,
        tool: n.tool,
        config: n.config ?? {},
        label: n.label,
        save_as: n.save_as,
        condition: n.condition,
        loop: n.loop,
      },
    };
}

function toFlowEdge(e: FlowEdgeDto): SmithyFlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.source_handle,
    ...edgeOptionsFor(e.source_handle),
  };
}

function toDoc(
  nodes: SmithyFlowNode[],
  edges: SmithyFlowEdge[],
): FlowDoc {
  return {
    version: 2,
    nodes: nodes.map((n) => {
      const d = n.data;
      const dto: FlowNodeDto = {
        id: n.id,
        kind: d.kind,
        config: d.config ?? {},
        position: [Math.round(n.position.x), Math.round(n.position.y)],
      };
      if (d.tool) dto.tool = d.tool;
      if (d.label) dto.label = d.label;
      if (d.save_as) dto.save_as = d.save_as;
      if (d.condition) dto.condition = d.condition;
      if (d.loop) dto.loop = d.loop;
      return dto;
    }),
    edges: edges.map((e) => ({
      id: e.id ?? newId(),
      source: e.source,
      source_handle: e.sourceHandle ?? "out",
      target: e.target,
    })),
  };
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<SmithyFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<SmithyFlowEdge>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [status, setStatus] = useState("");
  const [debug, setDebug] = useState<DebugState | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const rf = useReactFlow<SmithyFlowNode, SmithyFlowEdge>();

  useEffect(() => {
    fetchTools()
      .then(setTools)
      .catch((e: Error) => setStatus(`tools: ${e.message}`));
    fetchFlow()
      .then(({ exists, flow }) => {
        if (!exists) {
          setNodes(starterDoc().nodes.map(toFlowNode));
          return;
        }
        const f = flow as Partial<FlowDoc> | null;
        if (!f || f.version !== 2) {
          setLegacy(true);
          setNodes(starterDoc().nodes.map(toFlowNode));
          setStatus("file is v1 (recording) — opened an empty v2 flow");
          return;
        }
        setNodes((f.nodes ?? []).map(toFlowNode));
        setEdges((f.edges ?? []).map(toFlowEdge));
      })
      .catch((e: Error) => setStatus(`load: ${e.message}`));
  }, [setNodes, setEdges]);

  const addNode = useCallback(
    (kind: NodeKind, tool: string | undefined, position: { x: number; y: number }) => {
      const id = newId();
      const data: SmithyNodeData = { kind, tool, config: {} };
      setNodes((ns) => ns.concat({ id, type: "smithy", position, data }));
      setSelectedId(id);
      setDirty(true);
    },
    [setNodes],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const payload = e.dataTransfer.getData("application/smithy");
      if (!payload) return;
      const { kind, tool } = JSON.parse(payload) as { kind: NodeKind; tool?: string };
      const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, tool, { x: Math.round(position.x), y: Math.round(position.y) });
    },
    [rf, addNode],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const source = nodes.find((n) => n.id === c.source);
      const kind = source?.data.kind;
      const handle =
        c.sourceHandle ?? (kind === "if" ? "true" : kind === "loop" ? "body" : "out");
      setEdges((es) =>
        addEdge(
          { ...c, id: newId(), sourceHandle: handle, ...edgeOptionsFor(handle) },
          es,
        ),
      );
      setDirty(true);
    },
    [nodes, setEdges],
  );

  const patchNode = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
      );
      setDirty(true);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((s) => (s === id ? null : s));
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  const save = useCallback(async () => {
    if (legacy && !window.confirm(
      "The existing file is a v1 recording. Saving will OVERWRITE it with a v2 flow. Continue?",
    )) {
      return;
    }
    try {
      await saveFlow(toDoc(nodes, edges));
      setLegacy(false);
      setDirty(false);
      setStatus(`saved ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setStatus(`save failed: ${(e as Error).message}`);
    }
  }, [nodes, edges, legacy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const newFlow = useCallback(() => {
    if (!window.confirm("Replace the canvas with a new empty flow?")) return;
    setNodes(starterDoc().nodes.map(toFlowNode));
    setEdges([]);
    setSelectedId(null);
    setDirty(true);
    setStatus("");
  }, [setNodes, setEdges]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const debugActive = debug !== null && debug.status !== "idle";

  // poll debug state while the panel is open
  useEffect(() => {
    if (debug === null) return;
    const id = window.setInterval(() => {
      debugState()
        .then(setDebug)
        .catch(() => undefined);
    }, 600);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debug === null]);

  // highlight the node the debugger is paused on
  const currentNodeId = debug?.current_node ?? null;
  const highlightedRef = useRef<string | null>(null);
  useEffect(() => {
    if (highlightedRef.current === currentNodeId) return;
    const prev = highlightedRef.current;
    highlightedRef.current = currentNodeId;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === prev || n.id === currentNodeId
          ? { ...n, data: { ...n.data, current: n.id === currentNodeId } }
          : n,
      ),
    );
  }, [currentNodeId, setNodes]);

  const startDebug = useCallback(async () => {
    try {
      const doc = { ...toDoc(nodes, edges), breakpoints: [...breakpoints] };
      setDebug(await debugStart(doc));
      setStatus("debug session started");
    } catch (e) {
      setStatus(`debug: ${(e as Error).message}`);
    }
  }, [nodes, edges, breakpoints]);

  const runDebugAction = useCallback(async (action: "step" | "resume" | "pause" | "stop") => {
    try {
      setDebug(await debugAction(action));
    } catch (e) {
      setStatus(`debug: ${(e as Error).message}`);
    }
  }, []);

  const evalExpression = useCallback(async (expression: string) => {
    try {
      const r = await debugEval(expression);
      setStatus(r.error ? `repl: ${r.error}` : `repl: ${expression} → ${r.result}`);
    } catch (e) {
      setStatus(`repl: ${(e as Error).message}`);
    }
  }, []);

  const closeDebug = useCallback(() => {
    void debugAction("stop").catch(() => undefined);
    setDebug(null);
  }, []);

  const toggleBreakpoint = useCallback(
    (id: string) => {
      setBreakpoints((bs) => {
        const next = new Set(bs);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (debug !== null) {
        void debugBreakpoint(id, !breakpoints.has(id)).catch(() => undefined);
      }
    },
    [debug, breakpoints],
  );

  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const commitLabel = useCallback(
    (id: string, label: string) => {
      patchNode(id, label ? { label } : { label: undefined });
      setEditingId(null);
    },
    [patchNode],
  );
  const nodeEditContext = { editingId, startEdit, commit: commitLabel };

  // keep breakpoint markers on nodes in sync with the set
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...n.data, breakpoint: breakpoints.has(n.id) } })),
    );
  }, [breakpoints, setNodes]);

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-emerald-100/70 via-background to-background text-foreground">
      <header className="flex items-center gap-3 border-b border-emerald-900/10 bg-card/80 px-4 py-2 backdrop-blur-md">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-md shadow-emerald-600/30">
          ⚒
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-tight">
            Smithy <span className="text-emerald-600">Designer</span>
          </span>
          <span className="block text-[11px] font-medium text-muted-foreground">
            visual process editor
          </span>
        </span>
        <Badge variant={dirty ? "secondary" : "outline"}>
          {legacy ? "v1 file loaded" : "flow v2"} · {dirty ? "unsaved ●" : "saved ✓"}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{status}</span>
        {!debugActive && (
          <Button variant="secondary" size="sm" onClick={() => void startDebug()}>
            Debug
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={newFlow}>
          New
        </Button>
        <Button size="sm" onClick={() => void save()}>
          Save (Ctrl+S)
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 p-2 pt-2">
        <Toolbox tools={tools} />
        <div className="mx-2 min-w-0 flex-1 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" onDrop={onDrop} onDragOver={onDragOver}>
        <NodeEditContext.Provider value={nodeEditContext}>
          <ReactFlow<SmithyFlowNode, SmithyFlowEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={edgeOptions}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              toggleBreakpoint(n.id);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setEditingId(null);
            }}
            onNodesDelete={() => setDirty(true)}
            onEdgesDelete={() => setDirty(true)}
            onNodeDragStop={() => setDirty(true)}
            deleteKeyCode={["Delete", "Backspace"]}
            colorMode="light"
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#c2d2c8" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(242, 247, 243, 0.8)"
              nodeColor="#059669"
            />
          </ReactFlow>
        </NodeEditContext.Provider>
      </div>
        <Properties
          node={selectedNode}
          tools={tools}
          onPatch={patchNode}
          onDelete={deleteNode}
        />
      </div>
      {debug !== null && (
        <DebugPanel
          state={debug}
          onStep={() => void runDebugAction("step")}
          onResume={() => void runDebugAction("resume")}
          onPause={() => void runDebugAction("pause")}
          onStop={() => void runDebugAction("stop")}
          onClose={closeDebug}
          onEval={(expr) => void evalExpression(expr)}
        />
      )}
    </div>
  );
}
