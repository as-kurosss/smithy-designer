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

export async function fetchFlow(): Promise<{
  exists: boolean;
  flow: unknown;
}> {
  return json(await fetch("/api/flow"));
}

export async function saveFlow(doc: FlowDoc): Promise<void> {
  await json(
    await fetch("/api/flow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
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
