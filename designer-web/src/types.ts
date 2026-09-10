import type { Edge, Node } from "@xyflow/react";

export type NodeKind = "start" | "end" | "if" | "tool" | "loop" | "set" | "fail" | "flow";

export type CondOp =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "gt"
  | "lt"
  | "exists"
  | "is_empty";

export interface Condition {
  var: string;
  op: CondOp;
  value?: string | number | boolean;
}

export interface LoopSpec {
  mode: "foreach" | "while";
  var?: string;
  as?: string;
  condition?: Condition;
  max_iterations?: number;
}

export type SmithyNodeData = {
  kind: NodeKind;
  tool?: string;
  config: Record<string, unknown>;
  label?: string;
  save_as?: string;
  condition?: Condition;
  loop?: LoopSpec;
  current?: boolean;
  breakpoint?: boolean;
  [key: string]: unknown;
};

export type SmithyFlowNode = Node<SmithyNodeData, "smithy">;
export type SmithyFlowEdge = Edge;

export interface FlowNodeDto {
  id: string;
  kind: NodeKind;
  tool?: string;
  config: Record<string, unknown>;
  label?: string;
  save_as?: string;
  condition?: Condition;
  loop?: LoopSpec;
  position: [number, number];
}

export interface FlowEdgeDto {
  id: string;
  source: string;
  source_handle: string;
  target: string;
}

export interface FlowDoc {
  version: 2;
  nodes: FlowNodeDto[];
  edges: FlowEdgeDto[];
  breakpoints?: string[];
}

export interface ToolSchemaProp {
  type?: string;
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
}

export interface ToolSchema {
  properties?: Record<string, ToolSchemaProp>;
}

export interface ToolInfo {
  name: string;
  description: string;
  schema: ToolSchema;
}

export const COND_OPS: CondOp[] = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "gt",
  "lt",
  "exists",
  "is_empty",
];

export function coerce(text: string): string | number | boolean {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !isNaN(Number(t))) return Number(t);
  return text;
}

const HANDLES_BY_KIND: Record<NodeKind, string[]> = {
  start: ["out"],
  end: [],
  tool: ["out", "error"],
  set: ["out", "error"],
  if: ["true", "false", "error"],
  loop: ["body", "done", "error"],
  fail: [],
  flow: ["out", "error"],
};

/** Graph sanity checks mirroring the server-side _validate_flow. */
export function validateFlow(
  nodes: FlowNodeDto[],
  edges: FlowEdgeDto[],
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  let starts = 0;
  for (const n of nodes) {
    ids.add(n.id);
    if (n.kind === "start") starts += 1;
    if (n.kind === "tool" && !n.tool) {
      problems.push(`tool node "${n.id}" has no tool`);
    }
  }
  if (starts === 0) problems.push("flow needs a start node");
  if (starts > 1) problems.push(`multiple start nodes (${starts})`);

  const seen = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      problems.push(`edge "${e.id}" references unknown node`);
      continue;
    }
    const src = nodes.find((n) => n.id === e.source);
    const allowed = (src && HANDLES_BY_KIND[src.kind]) ?? [];
    if (!allowed.includes(e.source_handle)) {
      problems.push(
        `edge "${e.id}": node "${e.source}" (${src?.kind}) has no handle "${e.source_handle}"`,
      );
    }
    const key = `${e.source}\u0000${e.source_handle}`;
    if (seen.has(key)) {
      problems.push(
        `node "${e.source}" handle "${e.source_handle}" has multiple outgoing edges`,
      );
    } else {
      seen.add(key);
    }
  }
  return problems;
}
