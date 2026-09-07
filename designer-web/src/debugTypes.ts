export type DebugStatus = "idle" | "running" | "paused" | "finished" | "error";

export interface DebugLogEntry {
  ts: number;
  level: "info" | "error" | "debug";
  msg: string;
}

export interface ReplEntry {
  ts: number;
  expression: string;
  result: string;
  error: string | null;
}

export interface DebugState {
  status: DebugStatus;
  current_node: string | null;
  error: string | null;
  variables: Record<string, unknown>;
  log: DebugLogEntry[];
  repl: ReplEntry[];
}
