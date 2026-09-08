import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { AppWindow, ChevronRight, GitBranch, Wrench } from "lucide-react";
import type { NodeKind, ToolInfo } from "../types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CONTROLS: { kind: NodeKind; label: string }[] = [
  { kind: "start", label: "start" },
  { kind: "end", label: "end" },
  { kind: "if", label: "if / branch" },
  { kind: "loop", label: "loop" },
  { kind: "set", label: "set variable" },
];

type TabId = "controls" | "windows";

const TABS: { id: TabId; label: string; icon: typeof GitBranch; hint?: string }[] = [
  { id: "controls", label: "Flow", icon: GitBranch, hint: "control-flow nodes" },
  { id: "windows", label: "Windows", icon: AppWindow, hint: "windows UI automation tools" },
];

const CATEGORIES: { label: string; tools: string[] }[] = [
  { label: "Mouse", tools: ["click", "drag", "hover", "scroll"] },
  { label: "Keyboard & text", tools: ["keyboard", "input_text", "set_text", "clipboard"] },
  {
    label: "Elements",
    tools: ["get_element", "list_elements", "get_text", "exists", "highlight", "select"],
  },
  { label: "Window & process", tools: ["window", "process", "screenshot"] },
  { label: "Timing", tools: ["delay", "wait"] },
];

function shortName(name: string): string {
  return name.replace(/^windows\./, "");
}

function categoryOf(name: string): string {
  const s = shortName(name);
  for (const c of CATEGORIES) {
    if (c.tools.includes(s)) return c.label;
  }
  return "Other";
}

function makeDragHandler(payload: { kind: NodeKind; tool?: string }) {
  return (e: DragEvent) => {
    e.dataTransfer.setData("application/smithy", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };
}

function ToolItem({ tool }: { tool: ToolInfo }) {
  return (
    <div
      title={tool.description}
      draggable
      onDragStart={makeDragHandler({ kind: "tool", tool: tool.name })}
      className="cursor-grab rounded-lg border border-emerald-900/10 bg-background px-2 py-1.5 transition-all hover:border-emerald-600/40 hover:bg-emerald-50/50 active:cursor-grabbing"
    >
      <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        {shortName(tool.name)}
      </span>
      <div className="truncate text-[10px] text-muted-foreground">
        {tool.description}
      </div>
    </div>
  );
}

export default function Toolbox({ tools }: { tools: ToolInfo[] }) {
  const [tab, setTab] = useState<TabId>("controls");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const filtered = tools.filter((t) =>
      t.name.toLowerCase().includes(q.toLowerCase()),
    );
    const map = new Map<string, ToolInfo[]>();
    for (const t of filtered) {
      const cat = categoryOf(t.name);
      const list = map.get(cat);
      if (list) list.push(t);
      else map.set(cat, [t]);
    }
    return map;
  }, [tools, q]);

  const toggleGroup = (label: string) => {
    setCollapsed((cs) => {
      const next = new Set(cs);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <aside className="panel-scroll flex w-52 shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/10">
      <div className="border-b border-emerald-900/10 p-1.5">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
                tab === t.id
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/40"
                  : "text-muted-foreground hover:bg-emerald-600/10 hover:text-emerald-900",
              )}
            >
              <t.icon className="h-3.5 w-3.5 shrink-0" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "controls" ? (
        <div className="panel-scroll flex-1 space-y-1 overflow-y-auto p-2">
          {CONTROLS.map((c) => (
            <div
              key={c.kind}
              draggable
              onDragStart={makeDragHandler({ kind: c.kind })}
              className="flex cursor-grab items-center gap-2 rounded-lg border border-emerald-900/10 bg-background px-2 py-1.5 text-xs font-medium transition-all hover:border-emerald-600/40 hover:bg-emerald-50/50 active:cursor-grabbing"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              {c.label}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="px-2 pt-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter tools…"
              className="h-7 text-xs"
            />
          </div>
          <div className="panel-scroll flex-1 space-y-1.5 overflow-y-auto p-2">
            {grouped.size === 0 && (
              <div className="px-2 py-1 text-[10px] text-muted-foreground">
                {tools.length === 0 ? "loading tools…" : "no match"}
              </div>
            )}
            {[...grouped.entries()].map(([label, items]) => {
              const open = q !== "" || !collapsed.has(label);
              return (
                <div key={label}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(label)}
                    className="flex w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-all hover:bg-emerald-600/10 hover:text-emerald-900"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    {label}
                    <span className="ml-auto font-sans font-normal normal-case tracking-normal text-muted-foreground/60">
                      {items.length}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-1 space-y-1">
                      {items.map((t) => (
                        <ToolItem key={t.name} tool={t} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="border-t border-emerald-900/10 px-3 py-2 text-[10px] text-muted-foreground">
        drag onto canvas · Del removes · right-click node = breakpoint
      </div>
    </aside>
  );
}
