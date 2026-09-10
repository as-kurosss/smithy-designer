import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { NodeKind, ToolInfo } from "../types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const LOGIC_NODES: { kind: NodeKind; label: string }[] = [
  { kind: "start", label: "start" },
  { kind: "end", label: "end" },
  { kind: "if", label: "if / branch" },
  { kind: "loop", label: "loop" },
  { kind: "set", label: "set variable" },
  { kind: "flow", label: "subflow" },
  { kind: "fail", label: "fail" },
];

interface SubCategory {
  label: string;
  tools: string[];
}

const WINDOWS_GROUPS: SubCategory[] = [
  { label: "Mouse", tools: ["windows.click", "windows.drag", "windows.hover", "windows.scroll"] },
  {
    label: "Keyboard & text",
    tools: ["windows.keyboard", "windows.input_text", "windows.set_text", "windows.clipboard"],
  },
  {
    label: "Elements",
    tools: [
      "windows.get_element",
      "windows.list_elements",
      "windows.get_text",
      "windows.exists",
      "windows.highlight",
      "windows.select",
    ],
  },
  {
    label: "Window & process",
    tools: ["windows.window", "windows.process", "windows.screenshot"],
  },
  { label: "Timing", tools: ["windows.delay", "windows.wait"] },
  { label: "Excel", tools: ["excel.read", "excel.write", "excel.append"] },
];

const OTHER_GROUPS: SubCategory[] = [{ label: "Files", tools: ["file"] }];

function shortName(name: string): string {
  return name.replace(/^windows\./, "");
}

function dragHandler(payload: { kind: NodeKind; tool?: string }) {
  return (e: DragEvent) => {
    e.dataTransfer.setData("application/smithy", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };
}

function Caret({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
    />
  );
}

function HeaderButton({
  label,
  count,
  open,
  onToggle,
  level,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  level: "group" | "sub";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-1 rounded-lg py-1.5 font-bold uppercase tracking-widest transition-colors hover:bg-muted hover:text-foreground",
        level === "group" ? "px-1.5 text-[10px]" : "pl-4 pr-1.5 text-[10px] text-muted-foreground",
      )}
    >
      <Caret open={open} />
      {label}
      {count !== undefined && (
        <span className="ml-auto font-sans font-normal normal-case tracking-normal text-muted-foreground/60">
          {count}
        </span>
      )}
    </button>
  );
}

export default function Toolbox({ tools }: { tools: ToolInfo[] }) {
  const [q, setQ] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

  const toggle = (setter: typeof setOpenGroups, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grouped = useMemo(() => {
    const filtered = tools.filter((tool) => tool.name.toLowerCase().includes(q.toLowerCase()));
    const windowsMap = new Map(WINDOWS_GROUPS.flatMap((g) => g.tools.map((t) => [t, g.label])));
    const otherMap = new Map(OTHER_GROUPS.flatMap((g) => g.tools.map((t) => [t, g.label])));

    const build = (groupLabel: string, subs: SubCategory[]) => {
      const map = new Map<string, ToolInfo[]>(subs.map((s) => [s.label, []]));
      const order = subs.map((s) => s.label);
      const out: { label: string; items: ToolInfo[] }[] = [];
      const push = (subLabel: string, tool: ToolInfo) => {
        if (!map.has(subLabel)) {
          map.set(subLabel, []);
          order.push(subLabel);
        }
        map.get(subLabel)!.push(tool);
      };
      for (const tool of filtered) {
        const inWindows = windowsMap.get(tool.name);
        const inOther = otherMap.get(tool.name);
        if (groupLabel === "Windows" && inWindows !== undefined) {
          push(inWindows, tool);
        } else if (groupLabel === "Other" && inWindows === undefined && inOther === undefined) {
          push("Other", tool);
        } else if (groupLabel === "Other" && inOther !== undefined) {
          push(inOther, tool);
        }
      }
      for (const label of order) {
        const items = map.get(label) ?? [];
        if (items.length > 0) out.push({ label, items });
      }
      return out;
    };

    return [
      { label: "Windows", subs: build("Windows", WINDOWS_GROUPS) },
      { label: "Other", subs: build("Other", OTHER_GROUPS) },
    ].filter((g) => g.subs.length > 0);
  }, [tools, q]);

  const searching = q !== "";
  const groupOpen = (label: string) => searching || openGroups.has(label);
  const subOpen = (key: string) => searching || openSubs.has(key);

  return (
    <div className="panel-scroll flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="border-b border-border p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter tools…"
          className="h-7 text-xs"
        />
      </div>
      <div className="panel-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        <div>
          <HeaderButton
            label="Logic"
            count={LOGIC_NODES.length}
            open={groupOpen("Logic")}
            onToggle={() => toggle(setOpenGroups, "Logic")}
            level="group"
          />
          {groupOpen("Logic") && (
            <div className="mb-1.5 mt-0.5 space-y-1 pl-3">
              {LOGIC_NODES.map((node) => (
                <div
                  key={node.kind}
                  draggable
                  onDragStart={dragHandler({ kind: node.kind })}
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium transition-all hover:border-primary/40 hover:bg-secondary active:cursor-grabbing"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  {node.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {grouped.map((group) => (
          <div key={group.label}>
            <HeaderButton
              label={group.label}
              open={groupOpen(group.label)}
              onToggle={() => toggle(setOpenGroups, group.label)}
              level="group"
            />
            {groupOpen(group.label) && (
              <div className="mb-1 space-y-0.5">
                {group.subs.map((sub) => {
                  const key = `${group.label}/${sub.label}`;
                  return (
                    <div key={key}>
                      <HeaderButton
                        label={sub.label}
                        count={sub.items.length}
                        open={subOpen(key)}
                        onToggle={() => toggle(setOpenSubs, key)}
                        level="sub"
                      />
                      {subOpen(key) && (
                        <div className="mb-1 mt-0.5 space-y-1 pl-6">
                          {sub.items.map((tool) => (
                            <div
                              key={tool.name}
                              title={tool.description}
                              draggable
                              onDragStart={dragHandler({ kind: "tool", tool: tool.name })}
                              className="cursor-grab rounded-lg border border-border bg-background px-2 py-1.5 transition-all hover:border-primary/40 hover:bg-secondary active:cursor-grabbing"
                            >
                              <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
                                <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
                                {shortName(tool.name)}
                              </span>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {tool.description}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {tools.length === 0 && (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">loading tools…</div>
        )}
      </div>
    </div>
  );
}
