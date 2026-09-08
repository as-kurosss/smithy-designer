import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Pause, Play, Square, StepForward, TerminalSquare, X } from "lucide-react";
import type { DebugState } from "../debugTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_PILL: Record<DebugState["status"], string> = {
  idle: "border-zinc-200 bg-zinc-100 text-zinc-700",
  running: "border-blue-200 bg-blue-100 text-blue-800",
  paused: "border-amber-200 bg-amber-100 text-amber-800",
  finished: "border-emerald-200 bg-emerald-100 text-emerald-800",
  error: "border-red-200 bg-red-100 text-red-800",
};

const PULSE_STATUS = new Set<DebugState["status"]>(["running", "paused"]);

function levelColor(level: string): string {
  if (level === "error") return "text-red-400";
  if (level === "debug") return "text-zinc-500";
  if (level === "warning") return "text-amber-300";
  return "text-green-300";
}

export default function DebugPanel({
  state,
  onStep,
  onResume,
  onPause,
  onStop,
  onClose,
  onEval,
}: {
  state: DebugState;
  onStep: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  onEval: (expression: string) => void;
}) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log.length, state.repl.length]);

  const paused = state.status === "paused" || state.status === "error";
  const running = state.status === "running";
  const active = state.status !== "idle" && state.status !== "finished";

  const stream = [
    ...state.log.map((e) => ({ ts: e.ts, kind: "log" as const, entry: e })),
    ...state.repl.map((e) => ({ ts: e.ts, kind: "repl" as const, entry: e })),
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

  const variables = Object.entries(state.variables);

  return (
    <div className="flex h-72 shrink-0 border-t border-emerald-900/10 bg-card">
      {/* left: controls + variables */}
      <div className="panel-scroll flex w-72 shrink-0 flex-col overflow-y-auto border-r border-emerald-900/10">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-emerald-900/10 px-3 py-2">
          <Badge variant="outline" className={cn("gap-1.5 font-medium", STATUS_PILL[state.status])}>
            {PULSE_STATUS.has(state.status) && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
              </span>
            )}
            {state.status}
          </Badge>
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
            <Button size="icon-xs" variant="ghost" onClick={onClose} title="hide panel">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {state.error && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 font-mono text-[11px] text-red-600">
            {state.error}
          </div>
        )}
        {state.current_node && (
          <div className="border-b border-emerald-900/10 px-3 py-1.5 text-[11px] text-muted-foreground">
            current node:{" "}
            <span className="font-mono text-foreground">{state.current_node}</span>
          </div>
        )}
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Variables
        </div>
        <div className="space-y-0.5 px-3 pb-3 font-mono text-[11px]">
          {variables.length === 0 && (
            <div className="text-muted-foreground">no variables yet</div>
          )}
          {variables.map(([name, value]) => (
            <div key={name} className="truncate" title={JSON.stringify(value, null, 2)}>
              <span className="text-primary">{name}</span>
              <span className="text-muted-foreground"> = </span>
              <span>{JSON.stringify(value) ?? "undefined"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* right: terminal */}
      <div className="flex min-w-0 flex-1 flex-col bg-zinc-950">
        <div
          ref={terminalRef}
          className="terminal-scroll flex-1 space-y-0.5 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        >
          {stream.map((item, i) =>
            item.kind === "log" ? (
              <div key={`l${i}`} className="flex gap-3">
                <span className="shrink-0 text-zinc-500">
                  {new Date(item.entry.ts).toLocaleTimeString()}
                </span>
                <span className="w-16 shrink-0 text-zinc-400">
                  [{item.entry.level.toUpperCase()}]
                </span>
                <span className={levelColor(item.entry.level)}>
                  {item.entry.msg}
                </span>
              </div>
            ) : (
              <div key={`r${i}`}>
                <div>
                  <span className="text-emerald-400">&gt;</span>{" "}
                  <span className="text-zinc-100">{item.entry.expression}</span>
                </div>
                {item.entry.error ? (
                  <div className="pl-3 text-red-400">{item.entry.error}</div>
                ) : (
                  <div className="pl-3 text-zinc-400">{item.entry.result}</div>
                )}
              </div>
            ),
          )}
          {stream.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <TerminalSquare className="h-6 w-6 text-zinc-600" />
              <div className="text-zinc-500">
                terminal — inspect and change variables:{" "}
                <span className="text-emerald-400">app_pid</span>,{" "}
                <span className="text-emerald-400">result[&quot;text&quot;]</span>,{" "}
                <span className="text-emerald-400">items = [1, 2, 3]</span>
              </div>
            </div>
          )}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-zinc-800 p-2">
          <span className="pl-1 font-mono text-sm text-emerald-400">&gt;</span>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="expression or name = value …"
            className="h-7 border-0 font-mono text-xs text-zinc-100 shadow-none placeholder:text-zinc-500 focus-visible:ring-0 dark:bg-transparent"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
      </div>
    </div>
  );
}
