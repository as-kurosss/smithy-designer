import type { Edge, Node } from "@xyflow/react";

export type NodeKind = "start" | "end" | "if" | "tool" | "loop" | "set";

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
