import { useCallback, useState } from "react";
import type { SmithyFlowNode, ToolInfo, ToolSchemaProp } from "../types";
import { COND_OPS, coerce } from "../types";
import type { Condition } from "../types";
import type { FlowFile } from "../api";
import { isIdentifier } from "./VariableRows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Crosshair } from "lucide-react";
import SelectorField, { findSelectorGroups } from "./SelectorField";
import type { SelectorGroup } from "./SelectorField";

function isRef(value: unknown): boolean {
  return typeof value === "string" && /\$[\w{]/.test(value);
}

function isQuoted(text: string): boolean {
  if (text.length < 2) return false;
  const first = text[0];
  const last = text[text.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}

/** Initial editor text: strings are shown quoted (Python-like). */
function initialText(def: ToolSchemaProp, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (def.type === "array" || def.type === "object") {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  const text = String(value);
  if (def.type === "string" && text !== "" && !isRef(text)) {
    return `"${text}"`;
  }
  return text;
}

/**
 * A schema-typed config input.
 *
 * Strings are edited Python-style — wrapped in quotes (``"text"`` or
 * ``'text'``) — or as a ``$ref``; a bare literal in a string field is
 * flagged. Numbers/JSON are validated and flagged on mismatch.
 */
function SchemaInput({
  def,
  value,
  onChange,
}: {
  def: ToolSchemaProp;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => initialText(def, value));
  const type = def.type;

  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  if (type === "array" || type === "object") {
    let error: string | null = null;
    if (text.trim() !== "" && !isRef(text)) {
      try {
        JSON.parse(text);
      } catch {
        error = `invalid JSON ${type}`;
      }
    }
    return (
      <>
        <Textarea
          className={cn(
            "h-20 min-h-0 font-mono text-xs",
            error && "border-destructive ring-1 ring-destructive/40",
          )}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            try {
              onChange(JSON.parse(raw));
            } catch {
              onChange(raw);
            }
          }}
        />
        {error && <span className="mt-0.5 block text-[10px] text-tag-red-tx">{error}</span>}
      </>
    );
  }

  if (type === "integer" || type === "number") {
    const error =
      text !== "" && !isRef(text) && Number.isNaN(Number(text))
        ? `expected a ${type} (or $var)`
        : null;
    return (
      <>
        <Input
          className="h-7 font-mono text-xs"
          aria-invalid={error ? true : undefined}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw === "" || isRef(raw)) {
              onChange(raw);
              return;
            }
            const num = Number(raw);
            onChange(Number.isNaN(num) ? raw : num);
          }}
        />
        {error && <span className="mt-0.5 block text-[10px] text-tag-red-tx">{error}</span>}
      </>
    );
  }

  // string
  const error =
    text !== "" && !isRef(text) && !isQuoted(text)
      ? 'wrap the string in quotes ("..." or \'...\')'
      : null;
  return (
    <>
      <Input
        className="h-7 font-mono text-xs"
        aria-invalid={error ? true : undefined}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (isRef(raw)) {
            onChange(raw);
          } else if (isQuoted(raw)) {
            onChange(raw.slice(1, -1));
          } else {
            onChange(raw);
          }
        }}
      />
      {error && <span className="mt-0.5 block text-[10px] text-tag-red-tx">{error}</span>}
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium">{children}</span>
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
  flows,
  onPatch,
  onOpenFlow,
  onOpenVars,
  onCaptureSelector,
  embedded = false,
}: {
  node: SmithyFlowNode | null;
  tools: ToolInfo[];
  flows: FlowFile[];
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onOpenFlow: (path: string) => void;
  onOpenVars?: () => void;
  onCaptureSelector?: () => void;
  embedded?: boolean;
}) {
  const patch = useCallback(
    (id: string, data: Record<string, unknown>) => onPatch(id, data),
    [onPatch],
  );

  if (!node) {
    return (
      <aside className="panel-scroll flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
        <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Properties
        </div>
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          Select a node to edit its properties.
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

  const body = (
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-foreground">
        {onCaptureSelector && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            title="Capture a selector from the desktop: hover the element, press CTRL (ESC cancels)"
            onClick={onCaptureSelector}
          >
            <Crosshair className="h-3.5 w-3.5" />
            Record selector
          </Button>
        )}
        {tool && (
          <>
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
                const value = (d.config as Record<string, unknown>)[key];
                const set = (next: unknown) =>
                  patch(node.id, { config: { ...d.config, [key]: next } });
                const typeLabel = def.enum ? def.enum.join(" | ") : def.type ?? "string";
                return (
                  <label key={key} className="block" title={def.description}>
                    <FieldLabel>
                      {key}
                      <span className="ml-1 font-mono text-[10px] font-normal normal-case text-muted-foreground/80">
                        {typeLabel}
                      </span>
                    </FieldLabel>
                    {def.enum ? (
                      <Select
                        className="h-7 text-xs"
                        value={String(value ?? def.default ?? "")}
                        onChange={(e) => set(e.target.value)}
                      >
                        {def.enum.map((opt) => (
                          <option key={String(opt)} value={String(opt)}>
                            {String(opt)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <SchemaInput
                        key={`${node.id}:${key}`}
                        def={def}
                        value={value ?? def.default}
                        onChange={set}
                      />
                    )}
                  </label>
                );
              })}
          </>
        )}

        {d.kind === "tool" && (
          <label className="block border-t border-border pt-2">
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
          <div className="border-t border-border pt-2">
            <ConditionEditor
              condition={
                d.condition ?? { var: "", op: "exists", value: "" } as unknown as Condition
              }
              onChange={(c) => patch(node.id, { condition: c })}
            />
          </div>
        )}

        {d.kind === "loop" && (
          <div className="space-y-2 border-t border-border pt-2">
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
          <div className="space-y-2 border-t border-border pt-2">
            <label className="block" title="plain identifier, no $ (a $ references a variable)">
              <FieldLabel>variable</FieldLabel>
              <Input
                className="h-7 font-mono text-xs"
                aria-invalid={
                  String(cfg.var ?? "") !== "" && !isIdentifier(String(cfg.var))
                    ? true
                    : undefined
                }
                value={String(cfg.var ?? "")}
                placeholder="items"
                onChange={(e) =>
                  patch(node.id, { config: { ...cfg, var: e.target.value, type: "auto" } })
                }
              />
              {String(cfg.var ?? "") !== "" && !isIdentifier(String(cfg.var)) && (
                <span className="mt-0.5 block text-[10px] text-tag-red-tx">
                  use a plain name like items (no $)
                </span>
              )}
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
          <div className="space-y-2 border-t border-border pt-2">
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
            {onOpenVars && (
              <Button variant="outline" size="sm" className="w-full" onClick={onOpenVars}>
                Inputs &amp; outputs
              </Button>
            )}
            <p className="text-[10px] leading-snug text-muted-foreground">
              Subflows always run isolated: they see global <span className="font-mono">G_…</span>{" "}
              variables plus their inputs.
            </p>
          </div>
        )}

        {d.kind === "fail" && (
          <div className="space-y-2 border-t border-border pt-2">
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
      </div>
  );

  if (embedded) return <div className="min-h-0">{body}</div>;

  return (
    <aside className="panel-scroll flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Properties
      </div>
      {body}
    </aside>
  );
}
