import { useCallback } from "react";
import type { SmithyFlowNode, ToolInfo, ToolSchemaProp } from "../types";
import { COND_OPS, coerce } from "../types";
import type { Condition } from "../types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import SelectorField, { findSelectorGroups } from "./SelectorField";
import type { SelectorGroup } from "./SelectorField";

function inputType(prop: ToolSchemaProp): "text" | "number" | "checkbox" | "textarea" {
  if (prop.enum) return "text";
  if (prop.type === "integer" || prop.type === "number") return "number";
  if (prop.type === "boolean") return "checkbox";
  if (prop.type === "array" || prop.type === "object") return "textarea";
  return "text";
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-0.5 block text-[10px] uppercase text-muted-foreground">{children}</span>
  );
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
}) {
  const needsValue = condition.op !== "exists" && condition.op !== "is_empty";
  return (
    <div className="space-y-2">
      <label className="block">
        <FieldLabel>variable</FieldLabel>
        <Input
          className="h-7 text-xs"
          value={condition.var}
          onChange={(e) => onChange({ ...condition, var: e.target.value })}
          placeholder="result"
        />
      </label>
      <label className="block">
        <FieldLabel>operator</FieldLabel>
        <Select
          className="h-7 text-xs"
          value={condition.op}
          onChange={(e) => onChange({ ...condition, op: e.target.value as Condition["op"] })}
        >
          {COND_OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </Select>
      </label>
      {needsValue && (
        <label className="block">
          <FieldLabel>value</FieldLabel>
          <Input
            className="h-7 text-xs"
            value={String(condition.value ?? "")}
            onChange={(e) => onChange({ ...condition, value: coerce(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

export default function Properties({
  node,
  tools,
  onPatch,
  onDelete,
}: {
  node: SmithyFlowNode | null;
  tools: ToolInfo[];
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const patch = useCallback(
    (id: string, data: Record<string, unknown>) => onPatch(id, data),
    [onPatch],
  );

  if (!node) {
    return (
      <aside className="panel-scroll w-60 shrink-0 overflow-hidden rounded-xl bg-card p-3 text-xs text-muted-foreground ring-1 ring-foreground/10">
        Select a node to edit its properties.
      </aside>
    );
  }

  const d = node.data;
  const cfg = (d.config ?? {}) as Record<string, unknown>;
  const tool = d.kind === "tool" ? tools.find((t) => t.name === d.tool) : undefined;
  const props = tool?.schema?.properties ?? {};
  const selectorGroups: SelectorGroup[] = findSelectorGroups(props);
  const selectorKeys = new Set(selectorGroups.flatMap((g) => g.keys));

  return (
    <aside className="panel-scroll flex w-60 shrink-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="border-b border-emerald-900/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Properties
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-foreground">
        <div className="text-[10px] font-mono text-muted-foreground">id: {node.id}</div>

        {d.kind !== "start" && d.kind !== "end" && (
          <label className="block">
            <FieldLabel>kind</FieldLabel>
            <Input
              className="h-7 text-xs"
              value={d.kind}
              readOnly
              title="kind is fixed by node type"
            />
          </label>
        )}

        {tool && (
          <>
            <div className="border-t border-emerald-900/10 pt-2 text-[11px] font-semibold text-primary">
              {tool.name}
            </div>
            {selectorGroups.map((g) => (
              <label key={g.prefix} className="block" title={`${g.label} — XML-like, click to open editor`}>
                <FieldLabel>{g.label}</FieldLabel>
                <SelectorField
                  config={d.config as Record<string, unknown>}
                  group={g}
                  onCommit={(attrs) => {
                    const next: Record<string, unknown> = { ...(d.config as Record<string, unknown>) };
                    for (const k of g.keys) delete next[k];
                    for (const k of g.keys) {
                      const v = attrs[k.slice(g.prefix.length)];
                      if (v !== undefined && v !== "") next[k] = v;
                    }
                    patch(node.id, { config: next });
                  }}
                />
              </label>
            ))}
            {Object.entries(props)
              .filter(([key]) => !selectorKeys.has(key))
              .map(([key, def]) => {
              const kind = inputType(def);
              const value = (d.config as Record<string, unknown>)[key] ?? def.default ?? "";
              return (
                <label key={key} className="block" title={def.description}>
                  <FieldLabel>
                    {key}
                    {def.enum && (
                      <span className="ml-1 normal-case text-muted-foreground/70">
                        ({def.enum.join(", ")})
                      </span>
                    )}
                  </FieldLabel>
                  {def.enum ? (
                    <Select
                      className="h-7 text-xs"
                      value={String(value)}
                      onChange={(e) =>
                        patch(node.id, {
                          config: { ...d.config, [key]: coerce(e.target.value) },
                        })
                      }
                    >
                      {def.enum.map((opt) => (
                        <option key={String(opt)} value={String(opt)}>
                          {String(opt)}
                        </option>
                      ))}
                    </Select>
                  ) : kind === "checkbox" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) =>
                        patch(node.id, {
                          config: { ...d.config, [key]: e.target.checked },
                        })
                      }
                    />
                  ) : kind === "textarea" ? (
                    <Textarea
                      className="h-20 min-h-0 font-mono text-xs"
                      value={typeof value === "string" ? value : JSON.stringify(value)}
                      onChange={(e) => {
                        let parsed: unknown = e.target.value;
                        try {
                          parsed = JSON.parse(e.target.value);
                        } catch {
                          /* keep raw while typing */
                        }
                        patch(node.id, { config: { ...d.config, [key]: parsed } });
                      }}
                    />
                  ) : (
                    <Input
                      className="h-7 text-xs"
                      type={kind === "number" ? "number" : "text"}
                      value={String(value)}
                      onChange={(e) =>
                        patch(node.id, {
                          config: { ...d.config, [key]: coerce(e.target.value) },
                        })
                      }
                    />
                  )}
                </label>
              );
            })}
          </>
        )}

        {d.kind === "tool" && (
          <label className="block border-t border-emerald-900/10 pt-2">
            <FieldLabel>save_as</FieldLabel>
            <Input
              className="h-7 text-xs"
              value={d.save_as ?? ""}
              placeholder="result"
              onChange={(e) => patch(node.id, { save_as: e.target.value })}
            />
          </label>
        )}

        {d.kind === "if" && (
          <div className="border-t border-emerald-900/10 pt-2">
            <div className="mb-1 text-[11px] font-semibold text-primary">condition</div>
            <ConditionEditor
              condition={
                d.condition ?? { var: "", op: "exists", value: "" } as unknown as Condition
              }
              onChange={(c) => patch(node.id, { condition: c })}
            />
          </div>
        )}

        {d.kind === "loop" && (
          <div className="space-y-2 border-t border-emerald-900/10 pt-2">
            <div className="text-[11px] font-semibold text-primary">loop</div>
            <label className="block">
              <FieldLabel>mode</FieldLabel>
              <Select
                className="h-7 text-xs"
                value={d.loop?.mode ?? "foreach"}
                onChange={(e) =>
                  patch(node.id, {
                    loop: { ...d.loop, mode: e.target.value as "foreach" | "while" },
                  })
                }
              >
                <option value="foreach">foreach</option>
                <option value="while">while</option>
              </Select>
            </label>
            {(d.loop?.mode ?? "foreach") === "foreach" ? (
              <>
                <label className="block">
                  <FieldLabel>iterate var</FieldLabel>
                  <Input
                    className="h-7 text-xs"
                    value={d.loop?.var ?? ""}
                    onChange={(e) =>
                      patch(node.id, { loop: { ...d.loop, var: e.target.value } })
                    }
                  />
                </label>
                <label className="block">
                  <FieldLabel>as</FieldLabel>
                  <Input
                    className="h-7 text-xs"
                    value={d.loop?.as ?? ""}
                    placeholder="item"
                    onChange={(e) =>
                      patch(node.id, { loop: { ...d.loop, as: e.target.value } })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <ConditionEditor
                  condition={
                    d.loop?.condition ?? { var: "", op: "exists" } as unknown as Condition
                  }
                  onChange={(c) =>
                    patch(node.id, { loop: { ...d.loop, condition: c } })
                  }
                />
                <label className="block">
                  <FieldLabel>max_iterations</FieldLabel>
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    value={d.loop?.max_iterations ?? 100}
                    onChange={(e) =>
                      patch(node.id, {
                        loop: { ...d.loop, max_iterations: coerce(e.target.value) as number },
                      })
                    }
                  />
                </label>
              </>
            )}
          </div>
        )}
        {d.kind === "set" && (
          <div className="space-y-2 border-t border-emerald-900/10 pt-2">
            <div className="text-[11px] font-semibold text-primary">set variable</div>
            <label className="block">
              <FieldLabel>name</FieldLabel>
              <Input
                className="h-7 font-mono text-xs"
                value={String(cfg.var ?? "")}
                placeholder="items"
                onChange={(e) =>
                  patch(node.id, { config: { ...cfg, var: e.target.value } })
                }
              />
            </label>
            <label className="block" title="auto detects numbers/bools/json; others force the type">
              <FieldLabel>type</FieldLabel>
              <Select
                className="h-7 text-xs"
                value={String(cfg.type ?? "auto")}
                onChange={(e) =>
                  patch(node.id, { config: { ...cfg, type: e.target.value } })
                }
              >
                {["auto", "string", "number", "bool", "json"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <FieldLabel>value</FieldLabel>
              <Textarea
                className="h-16 min-h-0 font-mono text-xs"
                value={String(cfg.value ?? "")}
                placeholder='"123" · true · [1, 2, 3] · {"a": 1}'
                onChange={(e) =>
                  patch(node.id, { config: { ...cfg, value: e.target.value } })
                }
              />
            </label>
          </div>
        )}

        {d.kind !== "start" && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => onDelete(node.id)}
          >
            Delete node
          </Button>
        )}
      </div>
    </aside>
  );
}
