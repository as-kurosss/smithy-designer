import { useCallback } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { SmithyFlowNode, ToolInfo, ToolSchemaProp } from "../types";
import { COND_OPS, coerce } from "../types";
import type { Condition } from "../types";
import type { FlowFile } from "../api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import SelectorField, { findSelectorGroups } from "./SelectorField";
import type { SelectorGroup } from "./SelectorField";

function inputType(prop: ToolSchemaProp): "text" | "checkbox" | "textarea" {
  if (prop.enum) return "text";
  if (prop.type === "boolean") return "checkbox";
  if (prop.type === "array" || prop.type === "object") return "textarea";
  // integers/numbers use a text input too: a plain number or a $var reference
  return "text";
}

/** JSON when parseable; array fields also accept one item per line. */
function parseTextareaValue(raw: string, def: ToolSchemaProp): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    if (def.type === "array" && !raw.trim().startsWith("[")) {
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }
    return raw; // keep raw while typing
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium">{children}</span>
  );
}

/** Parse JSON when possible; otherwise keep the raw string (engine validates). */
function parseJsonOrRaw(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function jsonText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
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
  flows,
  onPatch,
  onDelete,
  onOpenFlow,
}: {
  node: SmithyFlowNode | null;
  tools: ToolInfo[];
  flows: FlowFile[];
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpenFlow: (path: string) => void;
}) {
  const patch = useCallback(
    (id: string, data: Record<string, unknown>) => onPatch(id, data),
    [onPatch],
  );

  if (!node) {
    return (
      <aside className="panel-scroll w-60 shrink-0 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/10">
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">No node selected</p>
          <p className="text-xs text-muted-foreground">
            Select a node to edit its properties.
          </p>
        </div>
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
    <aside className="panel-scroll flex w-60 shrink-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/10">
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
            <div className="flex items-center gap-2 border-t border-emerald-900/10 pt-2 text-xs font-medium">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="break-all font-mono">{tool.name}</span>
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
                    {(def.type === "integer" || def.type === "number") && (
                      <span className="ml-1 normal-case text-muted-foreground/70">
                        · number or $var
                      </span>
                    )}
                    {def.type === "array" && (
                      <span className="ml-1 normal-case text-muted-foreground/70">
                        · one per line or JSON
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
                      onChange={(e) =>
                        patch(node.id, {
                          config: {
                            ...d.config,
                            [key]: parseTextareaValue(e.target.value, def),
                          },
                        })
                      }
                    />
                  ) : (
                    <Input
                      className="h-7 text-xs"
                      type="text"
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
            <div className="mb-1.5 text-xs font-semibold">condition</div>
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
            <div className="text-xs font-semibold">loop</div>
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
            <div className="text-xs font-semibold">set variable</div>
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

        {d.kind === "flow" && (
          <div className="space-y-2 border-t border-emerald-900/10 pt-2">
            <div className="text-xs font-semibold">subflow</div>
            <label className="block">
              <FieldLabel>path</FieldLabel>
              <Select
                className="h-7 text-xs"
                value={String(cfg.path ?? "")}
                onChange={(e) => patch(node.id, { config: { ...cfg, path: e.target.value } })}
              >
                <option value="">— pick a flow —</option>
                {flows.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </Select>
            </label>
            {typeof cfg.path === "string" && cfg.path !== "" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onOpenFlow(cfg.path as string)}
              >
                Open subflow
              </Button>
            )}
            <label
              className="block"
              title="shared = same variables; isolated = only declared inputs/outputs"
            >
              <FieldLabel>scope</FieldLabel>
              <Select
                className="h-7 text-xs"
                value={String(cfg.scope ?? "shared")}
                onChange={(e) => patch(node.id, { config: { ...cfg, scope: e.target.value } })}
              >
                <option value="shared">shared</option>
                <option value="isolated">isolated</option>
              </Select>
            </label>
            <label className="block">
              <FieldLabel>inputs (JSON)</FieldLabel>
              <Textarea
                className="h-16 min-h-0 font-mono text-xs"
                value={jsonText(cfg.inputs)}
                placeholder='{ "user": "$username" }'
                onChange={(e) =>
                  patch(node.id, { config: { ...cfg, inputs: parseJsonOrRaw(e.target.value) } })
                }
              />
            </label>
            {cfg.scope === "isolated" && (
              <label className="block">
                <FieldLabel>outputs (JSON)</FieldLabel>
                <Textarea
                  className="h-16 min-h-0 font-mono text-xs"
                  value={jsonText(cfg.outputs)}
                  placeholder='{ "session": "token" } or ["result"]'
                  onChange={(e) =>
                    patch(node.id, {
                      config: { ...cfg, outputs: parseJsonOrRaw(e.target.value) },
                    })
                  }
                />
              </label>
            )}
          </div>
        )}

        {d.kind === "fail" && (
          <div className="space-y-2 border-t border-emerald-900/10 pt-2">
            <div className="text-xs font-semibold">fail</div>
            <label className="block" title="business = bad data, no retry; system = infra, retried">
              <FieldLabel>mode</FieldLabel>
              <Select
                className="h-7 text-xs"
                value={String(cfg.mode ?? "business")}
                onChange={(e) => patch(node.id, { config: { ...cfg, mode: e.target.value } })}
              >
                <option value="business">business (no retry)</option>
                <option value="system">system (retried)</option>
              </Select>
            </label>
            <label className="block">
              <FieldLabel>message</FieldLabel>
              <Input
                className="h-7 text-xs"
                value={String(cfg.message ?? "")}
                placeholder="amount is $amount"
                onChange={(e) => patch(node.id, { config: { ...cfg, message: e.target.value } })}
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
