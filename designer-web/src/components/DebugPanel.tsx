import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Pause, Play, Square, StepForward, TerminalSquare } from "lucide-react";
import type { DebugState } from "../debugTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_PILL: Record<DebugState["status"], string> = {
  idle: "border-border bg-muted text-muted-foreground",
  running: "border-tag-blue-tx/30 bg-tag-blue-bg text-tag-blue-tx",
  paused: "border-tag-yellow-tx/30 bg-tag-yellow-bg text-tag-yellow-tx",
  finished: "border-tag-green-tx/30 bg-tag-green-bg text-tag-green-tx",
  error: "border-tag-red-tx/30 bg-tag-red-bg text-tag-red-tx",
};

const PULSE_STATUS = new Set<DebugState["status"]>(["running", "paused"]);

function levelColor(level: string): string {
  if (level === "error") return "text-tag-red-tx";
  if (level === "warning") return "text-tag-yellow-tx";
  if (level === "debug") return "text-muted-foreground";
  return "text-foreground";
}

export default function DebugPanel({
  state,
  onStep,
  onResume,
  onPause,
  onStop,
  onEval,
}: {
  state: DebugState | null;
  onStep: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onEval: (expression: string) => void;
}) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.log.length, state?.repl.length]);

  const paused = state?.status === "paused" || state?.status === "error";
  const running = state?.status === "running";
  const active = state != null && state.status !== "idle" && state.status !== "finished";

  const stream = [
    ...(state?.log ?? []).map((e) => ({ ts: e.ts, kind: "log" as const, entry: e })),
    ...(state?.repl ?? []).map((e) => ({ ts: e.ts, kind: "repl" as const, entry: e })),
  ].sort((a, b) => a.ts - b.ts);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const expr = command.trim();
    if (!expr) return;
    onEval(expr);
    setHistory((h) => [...h, expr]);
    setHistoryIdx(-1);
    setCommand("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setCommand(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const idx = historyIdx + 1;
      if (idx >= history.length) {
        setHistoryIdx(-1);
        setCommand("");
      } else {
        setHistoryIdx(idx);
        setCommand(history[idx]);
      }
    }
  };

  const variables = Object.entries(state?.variables ?? {});

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Console
        </span>
        {state ? (
          <Badge variant="outline" className={cn("gap-1.5 font-medium", STATUS_PILL[state.status])}>
            {PULSE_STATUS.has(state.status) && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
              </span>
            )}
            {state.status}
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            idle — press Debug to run and step
          </span>
        )}
        {state?.current_node && (
          <span className="text-[11px] text-muted-foreground">
            node <span className="font-mono text-foreground">{state.current_node}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" onClick={onStep} disabled={!paused}>
            <StepForward className="h-3 w-3" />
            Step
          </Button>
          <Button size="xs" variant="outline" onClick={onResume} disabled={!paused}>
            <Play className="h-3 w-3" />
            Resume
          </Button>
          <Button size="xs" variant="outline" onClick={onPause} disabled={!running}>
            <Pause className="h-3 w-3" />
            Pause
          </Button>
          <Button size="xs" variant="destructive" onClick={onStop} disabled={!active}>
            <Square className="h-3 w-3" />
            Stop
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="panel-scroll hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border md:flex">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Variables
          </div>
          <div className="space-y-0.5 px-3 pb-2 font-mono text-[11px]">
            {variables.length === 0 && <div className="text-muted-foreground">—</div>}
            {variables.map(([name, value]) => (
              <div key={name} className="truncate" title={JSON.stringify(value, null, 2)}>
                <span className="text-primary">{name}</span>
                <span className="text-muted-foreground"> = </span>
                <span>{JSON.stringify(value) ?? "undefined"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {state?.error && (
            <div className="border-b border-tag-red-tx/20 bg-tag-red-bg px-3 py-1 font-mono text-[11px] text-tag-red-tx">
              {state.error}
            </div>
          )}
          <div
            ref={terminalRef}
            className="panel-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
          >
            {stream.map((item, i) =>
              item.kind === "log" ? (
                <div key={`l${i}`} className="flex gap-3">
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(item.entry.ts).toLocaleTimeString()}
                  </span>
                  <span className="w-16 shrink-0 text-muted-foreground">
                    [{item.entry.level.toUpperCase()}]
                  </span>
                  <span className={levelColor(item.entry.level)}>{item.entry.msg}</span>
                </div>
              ) : (
                <div key={`r${i}`}>
                  <div>
                    <span className="text-primary">&gt;</span>{" "}
                    <span className="text-foreground">{item.entry.expression}</span>
                  </div>
                  {item.entry.error ? (
                    <div className="pl-3 text-tag-red-tx">{item.entry.error}</div>
                  ) : (
                    <div className="pl-3 text-muted-foreground">{item.entry.result}</div>
                  )}
                </div>
              ),
            )}
            {stream.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <TerminalSquare className="h-6 w-6 text-muted-foreground/60" />
                <div className="text-muted-foreground">
                  logs appear here during a debug run — REPL:{" "}
                  <span className="text-primary">app_pid</span>,{" "}
                  <span className="text-primary">result[&quot;text&quot;]</span>,{" "}
                  <span className="text-primary">items = [1, 2, 3]</span>
                </div>
              </div>
            )}
          </div>
          <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-1.5">
            <span className="pl-1 font-mono text-sm text-primary">&gt;</span>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="expression or name = value …"
              className="h-7 border-0 font-mono text-xs shadow-none focus-visible:ring-0"
              spellCheck={false}
              autoComplete="off"
            />
          </form>
        </div>
      </div>
    </div>
  );
}
