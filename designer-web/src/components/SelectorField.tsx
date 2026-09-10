import { useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolSchemaProp } from "../types";

export const CONTROL_TYPES = [
  "button",
  "calendar",
  "checkbox",
  "combobox",
  "edit",
  "hyperlink",
  "image",
  "listitem",
  "list",
  "menu",
  "menubar",
  "menuitem",
  "progressbar",
  "radiobutton",
  "scrollbar",
  "slider",
  "spinner",
  "statusbar",
  "tab",
  "tabitem",
  "toolbar",
  "tooltip",
  "tree",
  "treeitem",
  "custom",
  "group",
  "thumb",
  "datagrid",
  "dataitem",
  "document",
  "splitbutton",
  "window",
  "pane",
  "header",
  "headeritem",
  "table",
  "titlebar",
  "separator",
  "appbar",
  "text",
] as const;

const SELECTOR_ATTRS = [
  "name",
  "automation_id",
  "control_type",
  "class_name",
] as const;

type SelectorAttr = (typeof SELECTOR_ATTRS)[number];

export interface SelectorGroup {
  prefix: string;
  label: string;
  keys: string[];
}

/** Selector attribute groups present in a tool schema (plain / from_* / to_*). */
export function findSelectorGroups(
  props: Record<string, ToolSchemaProp>,
): SelectorGroup[] {
  const keys = Object.keys(props);
  const groups: SelectorGroup[] = [];
  const build = (prefix: string, label: string) => {
    const gk = SELECTOR_ATTRS.map((a) => prefix + a).filter((k) => keys.includes(k));
    if (gk.length > 0) groups.push({ prefix, label, keys: gk });
  };
  build("", "selector");
  build("from_", "from selector");
  build("to_", "to selector");
  return groups;
}

export function composeSelector(
  config: Record<string, unknown>,
  group: SelectorGroup,
): string {
  const parts = group.keys
    .map((k) => [k.slice(group.prefix.length), config[k]])
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    );
  if (parts.length === 0) return "";
  return `<Element ${parts.join(" ")}/>`;
}

export function parseSelector(text: string): {
  attrs: Partial<Record<SelectorAttr, string>>;
  error: string | null;
} {
  const t = text.trim();
  if (!t) return { attrs: {}, error: null };
  const m = /^<(Element|Selector)\b([\s\S]*?)\s*\/>$/.exec(t);
  if (!m) {
    return { attrs: {}, error: 'syntax: <Element name="…" control_type="…"/>' };
  }
  const attrs: Partial<Record<SelectorAttr, string>> = {};
  const re = /(\w+)\s*=\s*"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(m[2])) !== null) {
    const key = match[1];
    if (key === "pid") {
      return {
        attrs: {},
        error: "pid is a separate field — edit it below the selector",
      };
    }
    if (!(SELECTOR_ATTRS as readonly string[]).includes(key)) {
      return { attrs: {}, error: `unknown attribute: ${key}` };
    }
    attrs[key as SelectorAttr] = match[2]
      .replace(/\\(.)/g, "$1")
      .replace(/&quot;/g, '"');
  }
  if (
    attrs.control_type !== undefined &&
    !CONTROL_TYPES.includes(attrs.control_type.toLowerCase() as (typeof CONTROL_TYPES)[number])
  ) {
    return { attrs: {}, error: `unknown control_type: ${attrs.control_type}` };
  }
  return { attrs, error: null };
}

interface Row {
  attr: SelectorAttr;
  value: string;
}

function SelectorModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: Row[];
  onClose: () => void;
  onSave: (rows: Row[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const used = new Set(rows.map((r) => r.attr));
  const available = SELECTOR_ATTRS.filter((a) => !used.has(a));

  const setRow = (attr: SelectorAttr, value: string) => {
    setError(null);
    setRows((rs) => rs.map((r) => (r.attr === attr ? { ...r, value } : r)));
  };
  const removeRow = (attr: SelectorAttr) => {
    setError(null);
    setRows((rs) => rs.filter((r) => r.attr !== attr));
  };
  const addRow = (attr: SelectorAttr) => {
    if (used.has(attr)) return;
    setRows((rs) =>
      [...rs, { attr, value: "" }].sort(
        (a, b) =>
          SELECTOR_ATTRS.indexOf(a.attr) - SELECTOR_ATTRS.indexOf(b.attr),
      ),
    );
  };

  const save = () => {
    for (const r of rows) {
      if (
        r.attr === "control_type" &&
        r.value !== "" &&
        !CONTROL_TYPES.includes(r.value.toLowerCase() as (typeof CONTROL_TYPES)[number])
      ) {
        setError(`unknown control_type: ${r.value}`);
        return;
      }
    }
    onSave(rows);
  };

  const xml = useMemo(() => {
    const parts = rows
      .filter((r) => r.value !== "")
      .map(
        (r) =>
          `${r.attr}="${r.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      );
    return parts.length ? `<Element ${parts.join(" ")}/>` : "";
  }, [rows]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-enter flex max-h-96 w-80 flex-col overflow-hidden rounded-xl bg-card shadow-xl ring-1 ring-foreground/10"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={onClose} title="close">
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {rows.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              no attributes — add one below
            </p>
          )}
          {rows.map((r) => (
            <div key={r.attr} className="flex items-center gap-1.5">
              <span className="w-24 shrink-0 truncate text-[10px] uppercase text-muted-foreground">
                {r.attr.replace(/_/g, " ")}
              </span>
              {r.attr === "control_type" ? (
                <select
                  value={r.value}
                  onChange={(e) => setRow(r.attr, e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>option]:bg-background"
                >
                  <option value="">— pick —</option>
                  {CONTROL_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={r.value}
                  onChange={(e) => setRow(r.attr, e.target.value)}
                  placeholder={r.attr === "name" ? "supports * ? wildcards" : ""}
                  className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                  type="text"
                  spellCheck={false}
                />
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                title={`remove ${r.attr}`}
                onClick={() => removeRow(r.attr)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && addRow(e.target.value as SelectorAttr)}
              className="h-7 w-full rounded-lg border border-dashed border-border bg-transparent px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted [&>option]:bg-background"
            >
              <option value="">+ add attribute…</option>
              {available.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="border-t border-border px-3 py-2">
          <code className="block truncate rounded-lg bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {xml || "\u00a0"}
          </code>
          {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SelectorField({
  config,
  group,
  onCommit,
}: {
  config: Record<string, unknown>;
  group: SelectorGroup;
  onCommit: (attrs: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => composeSelector(config, group));
  const [error, setError] = useState<string | null>(null);
  const xml = composeSelector(config, group);

  // keep the raw text in sync when the config changes elsewhere
  useEffect(() => {
    setText(composeSelector(config, group));
    setError(null);
  }, [config, group]);

  /** Commit raw text: parse, validate, push attrs. Keeps raw on error. */
  const commitText = (raw: string) => {
    const { attrs, error: parseError } = parseSelector(raw);
    if (parseError) {
      setError(parseError);
      return;
    }
    setError(null);
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === "") continue;
      next[k] = v;
    }
    onCommit(next);
    setText(composeSelector(next, group));
  };

  const rowsFromText = (): Row[] => {
    const parsed = parseSelector(text);
    const source = parsed.error ? config : (parsed.attrs as Record<string, unknown>);
    return group.keys.map((k) => {
      const attr = k.slice(group.prefix.length) as SelectorAttr;
      const v = source[attr];
      return { attr, value: v === undefined || v === null ? "" : String(v) };
    });
  };

  const save = (rows: Row[]) => {
    const attrs: Record<string, unknown> = {};
    for (const r of rows) {
      if (r.value === "") continue;
      attrs[r.attr] = r.value;
    }
    onCommit(attrs);
    setOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => commitText(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              setText(xml);
              setError(null);
              e.currentTarget.blur();
            }
          }}
          placeholder='<Element name="…" control_type="…"/>'
          spellCheck={false}
          title="click, select and Ctrl+C — or edit inline; Enter applies"
          className={cn(
            "h-7 min-w-0 flex-1 rounded-lg border bg-muted/40 px-2 font-mono text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50",
            error ? "border-destructive" : "border-input",
          )}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          title="open attribute editor"
          onClick={() => setOpen(true)}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>
      {error && <p className="mt-0.5 text-[9px] text-destructive">{error}</p>}
      {open && (
        <SelectorModal
          title={group.label}
          initial={rowsFromText()}
          onClose={() => setOpen(false)}
          onSave={save}
        />
      )}
    </>
  );
}
