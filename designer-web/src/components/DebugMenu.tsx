import { useEffect, useRef, useState } from "react";
import { Bug, Check, ChevronDown, Pause, Play, Square, StepForward } from "lucide-react";
import type { ReactNode } from "react";
import type { DebugState } from "../debugTypes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DebugMenu({
  state,
  onPlay,
  onAction,
  devCapture,
  onToggleDevCapture,
  disabled,
}: {
  state: DebugState | null;
  onPlay: () => void;
  onAction: (action: "step" | "resume" | "pause" | "stop") => void;
  devCapture: boolean;
  onToggleDevCapture: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = state != null && state.status !== "idle" && state.status !== "finished";
  const paused = state?.status === "paused" || state?.status === "error";
  const running = state?.status === "running";

  const run = (action: "step" | "resume" | "pause" | "stop") => {
    onAction(action);
    setOpen(false);
  };

  const Item = ({
    icon,
    label,
    hint,
    onClick,
    disabled: itemDisabled,
    destructive,
  }: {
    icon: ReactNode;
    label: string;
    hint?: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }) => (
    <button
      type="button"
      disabled={itemDisabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
        destructive
          ? "text-tag-red-tx hover:bg-tag-red-bg"
          : "text-foreground hover:bg-muted",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="sm"
        title="Debug controls"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Bug className="h-4 w-4" />
        Debug
        <ChevronDown className="h-3 w-3 opacity-70" />
      </Button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-48 -translate-x-1/2 space-y-0.5 rounded-lg border border-border bg-card p-1 shadow-xl">
          <Item
            icon={<Play className="h-3.5 w-3.5" />}
            label="Play"
            hint="to breakpoint"
            onClick={() => {
              onPlay();
              setOpen(false);
            }}
            disabled={active}
          />
          <div className="my-0.5 border-t border-border" />
          <Item
            icon={<StepForward className="h-3.5 w-3.5" />}
            label="Step"
            hint="next node"
            onClick={() => run("step")}
            disabled={!paused}
          />
          <Item
            icon={<Play className="h-3.5 w-3.5" />}
            label="Resume"
            hint="to breakpoint"
            onClick={() => run("resume")}
            disabled={!paused}
          />
          <Item
            icon={<Pause className="h-3.5 w-3.5" />}
            label="Pause"
            hint="at next node"
            onClick={() => run("pause")}
            disabled={!running}
          />
          <Item
            icon={<Square className="h-3.5 w-3.5" />}
            label="Stop"
            onClick={() => run("stop")}
            disabled={!active}
            destructive
          />
          <div className="my-0.5 border-t border-border" />
          <button
            type="button"
            title="Re-capture missing/stale selectors while running (nodes with a key field)"
            onClick={onToggleDevCapture}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {devCapture && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            <span className="flex-1">Dev capture</span>
            <span className="text-[10px] text-muted-foreground">
              {devCapture ? "on" : "off"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
