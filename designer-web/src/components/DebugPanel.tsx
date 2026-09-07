import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { DebugState } from "../debugTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STATUS_VARIANT: Record<
  DebugState["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  idle: "outline",
  running: "default",
  paused: "secondary",
  finished: "outline",
  error: "destructive",
};

function levelColor(level: string): string {
  if (level === "error") return "text-destructive";
  if (level === "debug") return "text-muted-foreground";
  return "text-foreground";
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
          <Badge variant={STATUS_VARIANT[state.status]}>{state.status}</Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button size="xs" onClick={onStep} disabled={!paused}>
              Step
            </Button>
            <Button size="xs" variant="outline" onClick={onResume} disabled={!paused}>
              Resume
            </Button>
            <Button size="xs" variant="outline" onClick={onPause} disabled={!running}>
              Pause
            </Button>
            <Button size="xs" variant="destructive" onClick={onStop} disabled={!active}>
              Stop
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={onClose} title="hide panel">
              ✕
            </Button>
          </div>
        </div>
        {state.error && (
          <div className="border-b border-emerald-900/10 bg-destructive/10 px-3 py-1.5 font-mono text-[11px] text-destructive">
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
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={terminalRef}
          className="panel-scroll terminal-scroll flex-1 space-y-0.5 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
        >
          {stream.map((item, i) =>
            item.kind === "log" ? (
              <div key={`l${i}`} className={levelColor(item.entry.level)}>
                {item.entry.msg}
              </div>
            ) : (
              <div key={`r${i}`}>
                <div>
                  <span className="text-primary">&gt;</span>{" "}
                  <span className="text-foreground">{item.entry.expression}</span>
                </div>
                {item.entry.error ? (
                  <div className="pl-3 text-destructive">{item.entry.error}</div>
                ) : (
                  <div className="pl-3 text-muted-foreground">{item.entry.result}</div>
                )}
              </div>
            ),
          )}
          {stream.length === 0 && (
            <div className="text-muted-foreground">
              terminal — inspect and change variables:{" "}
              <span className="text-secondary-foreground">app_pid</span>,{" "}
              <span className="text-secondary-foreground">result[&quot;text&quot;]</span>,{" "}
              <span className="text-secondary-foreground">items = [1, 2, 3]</span>
            </div>
          )}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-emerald-900/10 p-2">
          <span className="pl-1 font-mono text-sm text-primary">&gt;</span>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="expression or name = value …"
            className="h-7 border-0 font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
      </div>
    </div>
  );
}
