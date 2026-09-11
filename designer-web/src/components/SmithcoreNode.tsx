import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Settings } from "lucide-react";
import type { Condition, LoopSpec, NodeKind, SmithcoreFlowNode } from "../types";

/* -- double-click label editing ------------------------------------------- */

export interface NodeEditContextValue {
  editingId: string | null;
  startEdit: (id: string) => void;
  commit: (id: string, label: string) => void;
  openVars: (id: string) => void;
}

export const NodeEditContext = createContext<NodeEditContextValue>({
  editingId: null,
  startEdit: () => undefined,
  commit: () => undefined,
  openVars: () => undefined,
});

const LabelEditor = ({
  nodeId,
  initial,
  done,
  className,
}: {
  nodeId: string;
  initial: string;
  done: () => void;
  className?: string;
}) => {
  const { commit } = useContext(NodeEditContext);
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const finish = () => {
    commit(nodeId, val.trim());
    done();
  };
  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish();
        if (e.key === "Escape") done();
      }}
      onBlur={finish}
      placeholder="label…"
      className={className}
      spellCheck={false}
    />
  );
};

function LabelView({ label, className }: { label?: string; className?: string }) {
  if (!label) return null;
  return (
    <span className={`italic leading-tight text-foreground/80 ${className ?? ""}`}>
      {label}
    </span>
  );
}

const HANDLE =
  "!h-3 !w-3 !min-w-0 !rounded-full !border-2 !border-card !bg-primary";
const ERROR_HANDLE =
  "!h-3 !w-3 !min-w-0 !rounded-full !border-2 !border-card !bg-destructive";
const TAG_BOTTOM = "absolute text-[9px] font-semibold uppercase leading-none text-tag-green-tx -bottom-3 left-1/2 -translate-x-1/2";
const TAG_RIGHT = "absolute text-[9px] font-semibold uppercase leading-none text-tag-green-tx left-4 -top-0.5";
const TAG_ERR = "absolute text-[9px] font-semibold uppercase leading-none text-destructive left-4 -top-0.5";

interface ShapeMeta {
  fill: string;
  stroke: string;
  text: string;
}

const SHAPE_META: Record<NodeKind, ShapeMeta> = {
  start: { fill: "#e7f3ec", stroke: "#448361", text: "text-tag-green-tx" },
  end: { fill: "#fee2e2", stroke: "#d44c47", text: "text-tag-red-tx" },
  if: { fill: "#e0f2fe", stroke: "#337ea9", text: "text-tag-blue-tx" },
  loop: { fill: "#fef3c7", stroke: "#cb912f", text: "text-tag-yellow-tx" },
  tool: { fill: "#ffffff", stroke: "#2e7d4f", text: "text-tag-green-tx" },
  set: { fill: "#edf3ec", stroke: "#2e7d4f", text: "text-tag-green-tx" },
  fail: { fill: "#fee2e2", stroke: "#d44c47", text: "text-tag-red-tx" },
  flow: { fill: "#eef2ff", stroke: "#6366f1", text: "text-indigo-700" },
};

function shortTool(tool?: string): string {
  return tool ? tool.replace(/^windows\./, "") : "?";
}

function condText(c?: Condition): string {
  if (!c || !c.var) return "condition not set";
  const noValue = c.op === "exists" || c.op === "is_empty";
  return noValue ? `${c.var} ${c.op}` : `${c.var} ${c.op} ${JSON.stringify(c.value)}`;
}

function loopText(l?: LoopSpec): string {
  if (!l || !l.mode) return "loop not set";
  if (l.mode === "foreach") return `for ${l.as || "item"} in $${l.var || "?"}`;
  return `while ${condText(l.condition)} · max ${l.max_iterations ?? "?"}`;
}

function BreakpointDot() {
  return (
    <span
      className="absolute -left-1.5 -top-1.5 z-10 h-3.5 w-3.5 rounded-full border-2 border-card bg-destructive"
      title="breakpoint — right-click to remove"
    />
  );
}

function TargetHandles({ hidden }: { hidden?: boolean }) {
  if (hidden) return null;
  return (
    <>
      <Handle type="target" position={Position.Top} id="in-top" className={HANDLE} />
      <Handle type="target" position={Position.Left} id="in-left" className={HANDLE} />
    </>
  );
}

/* -- diamond (decision / loop) ------------------------------------------- */

function DiamondNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const kind = data.kind;
  const meta = SHAPE_META[kind];
  const isIf = kind === "if";
  const { editingId, startEdit } = useContext(NodeEditContext);
  const editing = editingId === id;
  return (
    <div
      onDoubleClick={() => startEdit(id)}
      className={`relative h-20 w-36 ${selected ? "drop-shadow-lg" : "drop-shadow-md"} ${data.current ? "animate-pulse" : ""}`}
    >
      {data.breakpoint && <BreakpointDot />}
      <svg viewBox="0 0 144 80" className="absolute inset-0 h-full w-full">
        <polygon
          points="72,3 141,40 72,77 3,40"
          fill={meta.fill}
          stroke={meta.stroke}
          strokeWidth={selected ? 4 : 2}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-6 text-center">
        <span className={`text-[9px] font-bold uppercase tracking-widest ${meta.text}`}>
          {isIf ? "If" : "Loop"}
        </span>
        {editing ? (
          <LabelEditor
            nodeId={id}
            initial={data.label ?? ""}
            done={() => startEdit("")}
            className="pointer-events-auto h-5 w-24 rounded-md border border-ring bg-card px-1 text-center text-[8px] text-foreground outline-none"
          />
        ) : (
          <>
            <LabelView label={data.label} className="line-clamp-1 w-full text-[8px] font-medium" />
            <span className="line-clamp-1 w-full text-[8px] leading-tight text-muted-foreground">
              {isIf ? condText(data.condition) : loopText(data.loop)}
            </span>
          </>
        )}
      </div>
      <TargetHandles />
      <Handle type="source" position={Position.Bottom} id={isIf ? "true" : "body"} className={HANDLE}>
        <span className={TAG_BOTTOM}>{isIf ? "true" : "body"}</span>
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id={isIf ? "false" : "done"}
        className={HANDLE}
        style={{ top: "72%" }}
      >
        <span className={TAG_RIGHT}>{isIf ? "false" : "done"}</span>
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        className={ERROR_HANDLE}
        style={{ top: "30%" }}
      >
        <span className={TAG_ERR}>err</span>
      </Handle>
    </div>
  );
}

/* -- stadium (terminator) ------------------------------------------------ */

function StadiumNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const meta = SHAPE_META[data.kind];
  const label = data.kind === "start" ? "Start" : "End";
  const { editingId, startEdit } = useContext(NodeEditContext);
  const editing = editingId === id;
  return (
    <div
      onDoubleClick={() => startEdit(id)}
      className={`flex h-10 w-24 flex-col items-center justify-center gap-0 rounded-full border-2 bg-card px-2 shadow-md shadow-primary/20 ${
        data.current ? "animate-pulse" : ""
      }`}
      style={{
        borderColor: meta.stroke,
        ...(selected ? { boxShadow: `0 0 0 2px ${meta.stroke}` } : {}),
      }}
    >
      {data.breakpoint && <BreakpointDot />}
      {editing ? (
        <LabelEditor
          nodeId={id}
          initial={data.label ?? ""}
          done={() => startEdit("")}
          className="h-4 w-20 rounded-md border border-ring bg-card text-center text-[8px] text-foreground outline-none"
        />
      ) : (
        <>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${meta.text}`}>
            {label}
          </span>
          <LabelView label={data.label} className="line-clamp-1 w-full text-center text-[8px]" />
        </>
      )}
      {data.kind === "start" && (
        <Handle type="source" position={Position.Bottom} id="out" className={HANDLE} />
      )}
      <TargetHandles hidden={data.kind === "start"} />
    </div>
  );
}

/* -- rectangle (set variable) --------------------------------------------- */

function ParallelogramNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const meta = SHAPE_META.set;
  const { editingId, startEdit } = useContext(NodeEditContext);
  const editing = editingId === id;
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const varName = String(cfg.var ?? "?");
  const rawValue = String(cfg.value ?? "");
  const shown =
    rawValue === "" ? "" : rawValue.length > 18 ? rawValue.slice(0, 17) + "…" : rawValue;
  return (
    <div
      onDoubleClick={() => startEdit(id)}
      className={`relative h-14 w-36 ${selected ? "drop-shadow-lg" : "drop-shadow-md"} ${data.current ? "animate-pulse" : ""}`}
    >
      {data.breakpoint && <BreakpointDot />}

      <svg viewBox="0 0 144 56" className="absolute inset-0 h-full w-full">
        <polygon
          points="3,3 141,3 141,53 3,53"
          fill={meta.fill}
          stroke={meta.stroke}
          strokeWidth={selected ? 4 : 2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-5 text-center">
        {editing ? (
          <LabelEditor
            nodeId={id}
            initial={data.label ?? ""}
            done={() => startEdit("")}
            className="h-4 w-24 rounded-md border border-ring bg-card text-center text-[8px] text-foreground outline-none"
          />
        ) : (
          <>
            <span className="truncate font-mono text-[9px] font-bold text-tag-green-tx">
              ${varName}
            </span>
            <LabelView label={data.label} className="line-clamp-1 w-full text-[8px]" />
            <span className="w-full truncate font-mono text-[8px] text-muted-foreground">
              = {shown}
            </span>
          </>
        )}
      </div>
      <TargetHandles />
      <Handle type="source" position={Position.Bottom} id="out" className={HANDLE} />
      <Handle type="source" position={Position.Right} id="error" className={ERROR_HANDLE}>
        <span className={TAG_ERR}>err</span>
      </Handle>
    </div>
  );
}

/* -- tool (card) ---------------------------------------------------------- */

function ToolNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const meta = SHAPE_META.tool;
  const { editingId, startEdit } = useContext(NodeEditContext);
  const editing = editingId === id;
  return (
    <div
      onDoubleClick={() => startEdit(id)}
      className={`relative w-36 rounded-xl border-2 bg-card text-card-foreground shadow-md shadow-primary/20 ${
        selected ? "ring-2 ring-ring" : ""
      } ${data.current ? "animate-pulse ring-2 ring-amber-500" : ""}`}
      style={{ borderColor: meta.stroke }}
    >
      {data.breakpoint && <BreakpointDot />}
      <div className="rounded-t-[10px] bg-secondary px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-tag-green-tx">
        Tool
      </div>
      <div className="truncate px-2 pt-0.5 text-xs font-medium">{shortTool(data.tool)}</div>
      {editing ? (
        <div className="px-2 pb-0.5">
          <LabelEditor
            nodeId={id}
            initial={data.label ?? ""}
            done={() => startEdit("")}
            className="h-4 w-full rounded-md border border-ring bg-card px-1 text-[8px] text-foreground outline-none"
          />
        </div>
      ) : (
        <LabelView
          label={data.label}
          className="block truncate px-2 pb-0.5 text-[8px]"
        />
      )}
      {data.save_as ? (
        <div className="truncate px-2 pb-0.5 text-[9px] text-muted-foreground">
          → <span className="font-mono text-primary">${data.save_as}</span>
        </div>
      ) : (
        <div className="pb-1" />
      )}
      <TargetHandles />
      <Handle type="source" position={Position.Bottom} id="out" className={HANDLE} />
      <Handle type="source" position={Position.Right} id="error" className={ERROR_HANDLE}>
        <span className={TAG_ERR}>err</span>
      </Handle>
    </div>
  );
}

/* -- subflow (calls another flow file) ------------------------------------ */

function FlowNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const { openVars } = useContext(NodeEditContext);
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const path = String(cfg.path ?? "");
  const name = path ? path.split("/").pop() || path : "pick a flow";
  return (
    <div
      className={`relative w-36 rounded-xl border-2 bg-card text-card-foreground shadow-md shadow-indigo-600/20 ${
        selected ? "ring-2 ring-indigo-500" : ""
      } ${data.current ? "animate-pulse ring-2 ring-amber-500" : ""}`}
      style={{ borderColor: SHAPE_META.flow.stroke }}
    >
      {data.breakpoint && <BreakpointDot />}
      <button
        type="button"
        title="Inputs & outputs"
        onClick={(e) => {
          e.stopPropagation();
          openVars(id);
        }}
        className="nodrag absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded text-indigo-700 hover:bg-white/70"
      >
        <Settings className="h-3 w-3" />
      </button>
      <div className="rounded-t-[10px] bg-indigo-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-700">
        Subflow
      </div>
      <div className="truncate px-2 pt-0.5 text-xs font-medium">{name}</div>
      <LabelView label={data.label} className="block truncate px-2 text-[8px]" />
      <div className="truncate px-2 pb-1 font-mono text-[8px] text-muted-foreground">
        {path || "double-click to open"}
      </div>
      <TargetHandles />
      <Handle type="source" position={Position.Bottom} id="out" className={HANDLE} />
      <Handle type="source" position={Position.Right} id="error" className={ERROR_HANDLE}>
        <span className={TAG_ERR}>err</span>
      </Handle>
    </div>
  );
}

/* -- fail (terminal failure) ---------------------------------------------- */

function FailNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: SmithcoreFlowNode["data"];
  selected?: boolean;
}) {
  const { editingId, startEdit } = useContext(NodeEditContext);
  const editing = editingId === id;
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const mode = String(cfg.mode ?? "business");
  const message = String(cfg.message ?? "");
  return (
    <div
      onDoubleClick={() => startEdit(id)}
      className={`relative h-14 w-32 ${selected ? "drop-shadow-lg" : "drop-shadow-md"} ${data.current ? "animate-pulse" : ""}`}
    >
      {data.breakpoint && <BreakpointDot />}
      <svg viewBox="0 0 128 56" className="absolute inset-0 h-full w-full">
        <polygon
          points="3,3 125,3 125,53 3,53"
          fill="#fee2e2"
          stroke="#d44c47"
          strokeWidth={selected ? 4 : 2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-3 text-center">
        {editing ? (
          <LabelEditor
            nodeId={id}
            initial={data.label ?? ""}
            done={() => startEdit("")}
            className="h-4 w-24 rounded-md border border-ring bg-card text-center text-[8px] text-foreground outline-none"
          />
        ) : (
          <>
            <span className="text-[9px] font-bold uppercase tracking-widest text-tag-red-tx">
              Fail · {mode}
            </span>
            <LabelView label={data.label} className="line-clamp-1 w-full text-[8px]" />
            <span className="line-clamp-1 w-full text-[8px] text-muted-foreground">
              {message || "no message"}
            </span>
          </>
        )}
      </div>
      <TargetHandles />
    </div>
  );
}

/* -- main ------------------------------------------------------------------ */

export default function SmithcoreNode({ id, data, selected }: NodeProps<SmithcoreFlowNode>) {
  if (data.kind === "if" || data.kind === "loop") {
    return <DiamondNode id={id} data={data} selected={selected} />;
  }
  if (data.kind === "set") return <ParallelogramNode id={id} data={data} selected={selected} />;
  if (data.kind === "tool") return <ToolNode id={id} data={data} selected={selected} />;
  if (data.kind === "flow") return <FlowNode id={id} data={data} selected={selected} />;
  if (data.kind === "fail") return <FailNode id={id} data={data} selected={selected} />;
  return <StadiumNode id={id} data={data} selected={selected} />;
}
