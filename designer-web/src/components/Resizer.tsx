import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * A draggable divider. ``orientation`` is the direction the divider runs:
 * ``"vertical"`` splits left/right (drag horizontally), ``"horizontal"``
 * splits top/bottom (drag vertically).
 */
export default function Resizer({
  orientation,
  onDelta,
  className,
}: {
  orientation: "vertical" | "horizontal";
  onDelta: (delta: number) => void;
  className?: string;
}) {
  const last = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = orientation === "vertical" ? e.clientX : e.clientY;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (last.current === null) return;
    const current = orientation === "vertical" ? e.clientX : e.clientY;
    onDelta(current - last.current);
    last.current = current;
  };

  const stop = (e: ReactPointerEvent<HTMLDivElement>) => {
    last.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      className={cn(
        "shrink-0 bg-border transition-colors hover:bg-primary/40 active:bg-primary/50",
        orientation === "vertical" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className,
      )}
    />
  );
}
