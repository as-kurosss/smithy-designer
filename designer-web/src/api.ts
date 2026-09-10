import type { FlowDoc, ToolInfo } from "./types";
import type { DebugState } from "./debugTypes";

async function json(res: Response): Promise<any> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : res.statusText;
    throw new Error(detail);
  }
  return body;
}

export async function fetchTools(): Promise<ToolInfo[]> {
  const data = await json(await fetch("/api/tools"));
  return data.tools as ToolInfo[];
}

export interface FlowFile {
  path: string;
  name: string;
  is_main: boolean;
}

export async function fetchFlows(): Promise<FlowFile[]> {
  const data = await json(await fetch("/api/flows"));
  return data.flows as FlowFile[];
}

export async function createFlow(name: string): Promise<FlowFile> {
  return json(
    await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function fetchFlow(path?: string): Promise<{
  exists: boolean;
  flow: unknown;
  path: string;
}> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return json(await fetch(`/api/flow${qs}`));
}

export async function saveFlow(doc: FlowDoc, path?: string): Promise<void> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  await json(
    await fetch(`/api/flow${qs}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    }),
  );
}

export interface PublishResult {
  name: string;
  version: string;
  orchestrator: string;
  process_id?: string;
  process_url?: string;
}

export async function publishFlow(payload: {
  url: string;
  token: string;
  name: string;
  version: string;
  allow_insecure?: boolean;
}): Promise<PublishResult> {
  return json(
    await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export interface RecordState {
  active: boolean;
  steps: number;
  error: string | null;
}

export async function recordStart(): Promise<RecordState> {
  return json(await fetch("/api/record/start", { method: "POST" }));
}

export async function recordStop(): Promise<{ flow: FlowDoc }> {
  return json(await fetch("/api/record/stop", { method: "POST" }));
}

export async function recordState(): Promise<RecordState> {
  return json(await fetch("/api/record/state"));
}

export interface ProjectSettings {
  variable_scope: "shared" | "isolated";
}

export async function fetchProject(): Promise<ProjectSettings> {
  return json(await fetch("/api/project"));
}

export async function updateProject(
  variable_scope: "shared" | "isolated",
): Promise<ProjectSettings> {
  return json(
    await fetch("/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variable_scope }),
    }),
  );
}

export async function debugStart(doc: FlowDoc): Promise<DebugState> {
  return json(
    await fetch("/api/debug/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    }),
  );
}

export type DebugAction = "step" | "resume" | "pause" | "stop";

export async function debugAction(action: DebugAction): Promise<DebugState> {
  return json(await fetch(`/api/debug/${action}`, { method: "POST" }));
}

export async function debugBreakpoint(
  nodeId: string,
  enabled: boolean,
): Promise<DebugState> {
  return json(
    await fetch("/api/debug/breakpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, enabled }),
    }),
  );
}

export async function debugState(): Promise<DebugState> {
  return json(await fetch("/api/debug/state"));
}

export async function debugEval(
  expression: string,
): Promise<{ result: string; error: string | null }> {
  return json(
    await fetch("/api/debug/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression }),
    }),
  );
}
