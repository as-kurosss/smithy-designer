import { useEffect, useRef } from "react";

export interface LogEntry {
  ts: number;
  msg: string;
}

export default function LogsPanel({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="flex items-center border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Designer log
        </span>
      </div>
      <div
        ref={ref}
        className="panel-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 && (
          <div className="text-muted-foreground">— no activity yet —</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-muted-foreground">
              {new Date(entry.ts).toLocaleTimeString()}
            </span>
            <span className="text-foreground">{entry.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
