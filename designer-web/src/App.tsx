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
import { Circle, Play, Save, Square, Upload, Workflow } from "lucide-react";
import { createFlow, fetchFlow, fetchFlows, fetchTools, saveFlow, debugStart, debugAction, debugState, debugEval, debugBreakpoint, recordStart, recordStop, recordState, captureSelector, type FlowFile, type RecordState } from "./api";
import type { DebugState } from "./debugTypes";
import { validateFlow } from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
import DebugMenu from "./components/DebugMenu";
import DebugPanel from "./components/DebugPanel";
import LogsPanel, { type LogEntry } from "./components/LogsPanel";
import PublishDialog from "./components/PublishDialog";
import ProjectTree from "./components/ProjectTree";
import { flowVarsToRows, rowsToFlowVars, type VarRow } from "./components/VariableRows";
import Resizer from "./components/Resizer";
import VariablesPanel from "./components/VariablesPanel";
import CreateSubflowModal from "./components/CreateSubflowModal";
import SubflowVarsModal from "./components/SubflowVarsModal";

const nodeTypes = { smithy: SmithyNodeComponent };
const edgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#747a75" },
  style: { stroke: "#747a75", strokeWidth: 2 },
};
const errorEdgeOptions = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#d44c47" },
  style: { stroke: "#d44c47", strokeWidth: 2 },
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
  variables: VarRow[] = [],
): FlowDoc {
  const vars = rowsToFlowVars(variables);
  return {
    version: 2,
    ...(vars.length > 0 ? { variables: vars } : {}),
    nodes: nodes.map((n) => {
      const d = n.data;
      const config = { ...(d.config ?? {}) } as Record<string, unknown>;
      // Subflows always run isolated; scope is not a per-node setting.
      if (d.kind === "flow") delete config.scope;
      const dto: FlowNodeDto = {
        id: n.id,
        kind: d.kind,
        config,
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [record, setRecord] = useState<RecordState | null>(null);
  const rf = useReactFlow<SmithyFlowNode, SmithyFlowEdge>();
  const [flows, setFlows] = useState<FlowFile[]>([]);
  const [activePath, setActivePath] = useState("flow.json");
  const [variableRows, setVariableRows] = useState<VarRow[]>(() => flowVarsToRows(undefined));
  const [leftTab, setLeftTab] = useState<"project" | "tools">("tools");
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);
  const [consoleHeight, setConsoleHeight] = useState(190);
  const [rightTab, setRightTab] = useState<"properties" | "variables">("properties");
  const [bottomTab, setBottomTab] = useState<"logs" | "console">("logs");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [devCapture, setDevCapture] = useState(false);
  const [subflowModalOpen, setSubflowModalOpen] = useState(false);
  const [subflowVarsId, setSubflowVarsId] = useState<string | null>(null);

  const loadFlow = useCallback(
    async (path: string) => {
      setLoadFailed(false);
      setLegacy(false);
      try {
        const { exists, flow } = await fetchFlow(path);
        if (!exists) {
          setNodes(starterDoc().nodes.map(toFlowNode));
          setEdges([]);
          setVariableRows(flowVarsToRows(undefined));
          setStatus("new flow — drag tools onto the canvas");
        } else {
          const f = flow as Partial<FlowDoc> | null;
          if (!f || f.version !== 2) {
            setLegacy(true);
            setNodes(starterDoc().nodes.map(toFlowNode));
            setEdges([]);
            setVariableRows(flowVarsToRows(undefined));
            setStatus("file is v1 (recording) — opened an empty v2 flow");
          } else {
            setNodes((f.nodes ?? []).map(toFlowNode));
            setEdges((f.edges ?? []).map(toFlowEdge));
            setVariableRows(flowVarsToRows(f.variables));
            setStatus("");
          }
        }
        setActivePath(path);
        setSelectedId(null);
        setEditingId(null);
        setBreakpoints(new Set());
        setDirty(false);
      } catch (e) {
        setLoadFailed(true);
        setStatus(`load failed: ${(e as Error).message} — editing disabled`);
      }
    },
    [setNodes, setEdges],
  );

  useEffect(() => {
    fetchTools()
      .then(setTools)
      .catch((e: Error) => setStatus(`tools: ${e.message}`));
    fetchFlows()
      .then((list) => {
        setFlows(list);
        const main = list.find((f) => f.is_main) ?? list[0];
        if (main) void loadFlow(main.path);
      })
      .catch((e: Error) => {
        setLoadFailed(true);
        setStatus(`load failed: ${e.message} — editing disabled`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addNode = useCallback(
    (kind: NodeKind, tool: string | undefined, position: { x: number; y: number }) => {
      const id = newId();
      const data: SmithyNodeData = { kind, tool, config: {} };
      setNodes((ns) => ns.concat({ id, type: "smithy", position, data }));
      setSelectedId(id);
      setRightTab("properties");
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

  const captureSelectorIntoNode = useCallback(async () => {
    if (!selectedId) return;
    const target = nodes.find((n) => n.id === selectedId);
    if (!target) return;
    setStatus("capturing selector — hover an element and press CTRL (ESC cancels)");
    try {
      const { selector } = await captureSelector();
      const cfg = { ...(target.data.config ?? {}) } as Record<string, unknown>;
      for (const [key, value] of Object.entries(selector)) {
        if (value !== undefined && value !== null && value !== "") cfg[key] = value;
      }
      patchNode(selectedId, { config: cfg });
      const keys = Object.keys(selector);
      setStatus(keys.length > 0 ? `selector captured: ${keys.join(", ")}` : "selector captured (empty)");
    } catch (e) {
      setStatus(`capture: ${(e as Error).message}`);
    }
  }, [selectedId, nodes, patchNode]);

  const save = useCallback(async (): Promise<boolean> => {
    if (loadFailed) return false;
    const doc = toDoc(nodes, edges, variableRows);
    const problems = validateFlow(doc.nodes, doc.edges);
    if (problems.length > 0) {
      setStatus(`validation: ${problems.join("; ")}`);
      return false;
    }
    if (legacy && !window.confirm(
      "The existing file is a v1 recording. Saving will OVERWRITE it with a v2 flow. Continue?",
    )) {
      return false;
    }
    try {
      await saveFlow(doc, activePath);
      setLegacy(false);
      setDirty(false);
      setStatus(`saved ${activePath} ${new Date().toLocaleTimeString()}`);
      return true;
    } catch (e) {
      setStatus(`save failed: ${(e as Error).message}`);
      return false;
    }
  }, [nodes, edges, legacy, loadFailed, activePath, variableRows]);

  const switchFlow = useCallback(
    async (path: string) => {
      if (path === activePath) return;
      if (dirty && !(await save())) return;
      await loadFlow(path);
    },
    [activePath, dirty, save, loadFlow],
  );

  const createSubflow = useCallback(
    async (name: string) => {
      try {
        const created = await createFlow(name);
        setFlows(await fetchFlows());
        if (dirty && !(await save())) return;
        await loadFlow(created.path);
        setStatus(`created ${created.path}`);
      } catch (e) {
        setStatus(`new subflow: ${(e as Error).message}`);
      }
    },
    [dirty, save, loadFlow],
  );

  const openPublish = useCallback(async () => {
    if (dirty && !(await save())) return;
    setPublishOpen(true);
  }, [dirty, save]);

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

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const subflowVarsNode = nodes.find((n) => n.id === subflowVarsId) ?? null;

  const debugActive = debug !== null && debug.status !== "idle";

  // designer activity log: mirror every status line into the Logs tab
  useEffect(() => {
    if (!status) return;
    setLogs((l) =>
      l.length > 0 && l[l.length - 1].msg === status
        ? l
        : [...l.slice(-199), { ts: Date.now(), msg: status }],
    );
  }, [status]);

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

  // poll the recorder while active (live step count / backend errors)
  useEffect(() => {
    if (record === null) return;
    const id = window.setInterval(() => {
      recordState()
        .then((s) => {
          if (!s.active) {
            setRecord(null);
            if (s.error) setStatus(`record: ${s.error}`);
          } else {
            setRecord(s);
          }
        })
        .catch(() => undefined);
    }, 600);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record === null]);

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

  const startSession = useCallback(
    async (bps: string[], label: string) => {
      const doc = { ...toDoc(nodes, edges, variableRows), breakpoints: bps };
      const problems = validateFlow(doc.nodes, doc.edges);
      if (problems.length > 0) {
        setStatus(`validation: ${problems.join("; ")}`);
        return;
      }
      try {
        await debugStart(doc, devCapture);
        setDebug(await debugAction("resume"));
        setStatus(label);
      } catch (e) {
        setStatus(`debug: ${(e as Error).message}`);
      }
    },
    [nodes, edges, variableRows, devCapture],
  );

  const runFlow = useCallback(() => startSession([], "run started"), [startSession]);

  const playDebug = useCallback(
    () => startSession([...breakpoints], "debug started — runs to breakpoint"),
    [startSession, breakpoints],
  );

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

  const startRecording = useCallback(async () => {
    try {
      setRecord(await recordStart());
      setStatus("recording — click around, then press Stop");
    } catch (e) {
      setStatus(`record: ${(e as Error).message}`);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      const { flow } = await recordStop();
      // Append the recorded steps to the current canvas instead of replacing
      // it; they are laid out vertically in a free column below existing nodes.
      const idMap = new Map<string, string>();
      const additions: SmithyFlowNode[] = [];
      for (const n of flow.nodes ?? []) {
        if (n.kind === "start" || n.kind === "end") continue;
        const nid = newId();
        idMap.set(n.id, nid);
        const node = toFlowNode(n);
        node.id = nid;
        additions.push(node);
      }
      if (additions.length > 0) {
        const baseY = nodes.length ? Math.max(...nodes.map((n) => n.position.y)) + 140 : 80;
        const baseX = nodes.length ? Math.min(...nodes.map((n) => n.position.x)) : 80;
        additions.forEach((n, i) => {
          n.position = { x: baseX, y: baseY + i * 130 };
        });
        setNodes((ns) => ns.concat(additions));
        const addEdges: SmithyFlowEdge[] = [];
        for (const e of flow.edges ?? []) {
          const source = idMap.get(e.source);
          const target = idMap.get(e.target);
          if (source && target) {
            addEdges.push({
              id: newId(),
              source,
              target,
              sourceHandle: e.source_handle,
              ...edgeOptionsFor(e.source_handle),
            });
          }
        }
        setEdges((es) => es.concat(addEdges));
      }
      setSelectedId(null);
      setDirty(true);
      setStatus(
        additions.length > 0
          ? `recorded ${additions.length} step(s) added below — review, then Save`
          : "nothing recorded",
      );
    } catch (e) {
      setStatus(`record: ${(e as Error).message}`);
    } finally {
      setRecord(null);
    }
  }, [nodes, setNodes, setEdges]);

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
  const nodeEditContext = {
    editingId,
    startEdit,
    commit: commitLabel,
    openVars: (id: string) => setSubflowVarsId(id),
  };

  // keep breakpoint markers on nodes in sync with the set
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...n.data, breakpoint: breakpoints.has(n.id) } })),
    );
  }, [breakpoints, setNodes]);

  // warn about unsaved work; stop an active debug session on page close
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (debug !== null && debug.status !== "idle" && debug.status !== "finished") {
        navigator.sendBeacon("/api/debug/stop");
      }
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, debug]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </span>
          <span className="shrink-0 text-sm font-bold tracking-tight">
            Smithy <span className="text-primary">Designer</span>
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            title="Run the flow"
            disabled={loadFailed || debugActive}
            onClick={() => void runFlow()}
          >
            <Play className="h-4 w-4" />
            Start
          </Button>
          <DebugMenu
            state={debug}
            onPlay={() => void playDebug()}
            onAction={(a) => void runDebugAction(a)}
            devCapture={devCapture}
            onToggleDevCapture={() => setDevCapture((v) => !v)}
            disabled={loadFailed}
          />
          {record !== null ? (
            <Button
              variant="destructive"
              size="sm"
              title="Stop recording"
              onClick={() => void stopRecording()}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              title="Recorder — capture desktop clicks/typing as flow steps (appends to the canvas)"
              disabled={loadFailed || debugActive}
              onClick={() => void startRecording()}
            >
              <Circle className="h-4 w-4 text-tag-red-tx" />
              Recorder
            </Button>
          )}
          <span className="mx-1.5 h-5 w-px bg-border" />
          <Button
            size="sm"
            title="Save (Ctrl+S)"
            disabled={loadFailed}
            onClick={() => void save()}
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="Publish to orchestrator"
            disabled={loadFailed}
            onClick={() => void openPublish()}
          >
            <Upload className="h-4 w-4" />
            Publish
          </Button>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {(legacy || dirty) && (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 gap-1.5 font-medium",
                legacy
                  ? "border-tag-red-tx/30 bg-tag-red-bg text-tag-red-tx"
                  : "border-tag-yellow-tx/30 bg-tag-yellow-bg text-tag-yellow-tx",
              )}
            >
              {legacy ? "v1" : "unsaved"}
            </Badge>
          )}
          <span className="hidden max-w-[16rem] shrink-0 truncate text-xs text-muted-foreground xl:block">
            {status}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div style={{ width: leftWidth }} className="flex min-h-0 shrink-0 flex-col gap-2 p-2">
          <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
            {(["project", "tools"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLeftTab(tab)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  leftTab === tab
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "project" ? "Project" : "Tools"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {leftTab === "project" ? (
              <ProjectTree
                flows={flows}
                activePath={activePath}
                onOpen={(path) => void switchFlow(path)}
                onCreate={() => setSubflowModalOpen(true)}
              />
            ) : (
              <Toolbox tools={tools} />
            )}
          </div>
        </div>

        <Resizer
          orientation="vertical"
          onDelta={(d) => setLeftWidth((w) => Math.max(180, Math.min(460, w + d)))}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-2">
          <div
            className="min-h-0 flex-1 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <NodeEditContext.Provider value={nodeEditContext}>
              <ReactFlow<SmithyFlowNode, SmithyFlowEdge>
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                defaultEdgeOptions={edgeOptions}
                onNodeClick={(_, n) => {
                  setSelectedId(n.id);
                  setRightTab("properties");
                }}
                onNodeDoubleClick={(_, n) => {
                  if (n.data.kind === "flow") {
                    const p = (n.data.config as Record<string, unknown> | undefined)?.path;
                    if (typeof p === "string" && p) void switchFlow(p);
                  }
                }}
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
                proOptions={{ hideAttribution: true }}
                fitView
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#c9d6cc" />
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  maskColor="rgba(244, 247, 244, 0.8)"
                  nodeColor="#2e7d4f"
                />
              </ReactFlow>
            </NodeEditContext.Provider>
          </div>

          <Resizer
            orientation="horizontal"
            onDelta={(d) => setConsoleHeight((h) => Math.max(0, Math.min(600, h - d)))}
          />
          <div
            style={{ height: consoleHeight }}
            className="flex min-h-0 shrink-0 flex-col overflow-hidden"
            hidden={consoleHeight <= 2}
          >
            <div className="mb-2 flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
              {(["logs", "console"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setBottomTab(tab)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    bottomTab === tab
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "logs" ? "Logs" : "Console"}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {bottomTab === "console" ? (
                <DebugPanel state={debug} onEval={(expr) => void evalExpression(expr)} />
              ) : (
                <LogsPanel logs={logs} />
              )}
            </div>
          </div>
        </div>

        <Resizer
          orientation="vertical"
          onDelta={(d) => setRightWidth((w) => Math.max(240, Math.min(560, w - d)))}
        />

        <div style={{ width: rightWidth }} className="flex min-h-0 shrink-0 flex-col gap-2 p-2">
          <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
            {(["properties", "variables"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  rightTab === tab
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "properties" ? "Properties" : "Variables"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {rightTab === "properties" ? (
              <Properties
                node={selectedNode}
                tools={tools}
                flows={flows}
                onPatch={patchNode}
                onOpenFlow={(path) => void switchFlow(path)}
                onOpenVars={
                  selectedNode?.data.kind === "flow"
                    ? () => setSubflowVarsId(selectedNode.id)
                    : undefined
                }
                onCaptureSelector={() => void captureSelectorIntoNode()}
              />
            ) : (
              <VariablesPanel
                rows={variableRows}
                onChange={setVariableRows}
                path={activePath}
                isMain={flows.find((f) => f.path === activePath)?.is_main ?? true}
              />
            )}
          </div>
        </div>
      </div>

      {publishOpen && (
        <PublishDialog defaultName="my-flow" onClose={() => setPublishOpen(false)} />
      )}
      {subflowModalOpen && (
        <CreateSubflowModal
          onCreate={(name) => void createSubflow(name)}
          onClose={() => setSubflowModalOpen(false)}
        />
      )}
      {subflowVarsNode && (
        <SubflowVarsModal
          node={subflowVarsNode}
          onPatch={patchNode}
          onClose={() => setSubflowVarsId(null)}
        />
      )}
    </div>
  );
}
