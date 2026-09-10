import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface VarRow {
  name: string;
  value: string;
  type?: string;
}

/** Types the engine understands for a flow variable (see `set` nodes). */
export const FLOW_VAR_TYPES = ["auto", "string", "number", "bool", "json"] as const;

/** Variable *names* are plain Python identifiers — never ``$name``. */
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_]\w*$/.test(name);
}

/** A record → editor rows; always at least one (blank) row. */
export function recordToRows(record: Record<string, string> | undefined): VarRow[] {
  const rows = Object.entries(record ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  return rows.length > 0 ? rows : [{ name: "", value: "" }];
}

/** Editor rows → record, dropping blank names. */
export function rowsToRecord(rows: VarRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) out[name] = row.value;
  }
  return out;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Flow `variables` (object or typed list) → editor rows. */
export function flowVarsToRows(raw: unknown): VarRow[] {
  if (Array.isArray(raw)) {
    const rows = raw
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        name: String(item.name ?? ""),
        type: typeof item.type === "string" ? item.type : "auto",
        value: asText(item.value),
      }));
    return rows.length > 0 ? rows : [{ name: "", value: "", type: "auto" }];
  }
  if (raw && typeof raw === "object") {
    const rows = Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({
      name,
      type: "auto",
      value: asText(value),
    }));
    return rows.length > 0 ? rows : [{ name: "", value: "", type: "auto" }];
  }
  return [{ name: "", value: "", type: "auto" }];
}

/** Editor rows → typed list stored in the flow document. */
export function rowsToFlowVars(rows: VarRow[]): Array<{ name: string; type: string; value: string }> {
  const out: Array<{ name: string; type: string; value: string }> = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (name) out.push({ name, type: row.type || "auto", value: row.value });
  }
  return out;
}

export default function VariableRows({
  rows,
  onChange,
  withTypes = false,
  namePlaceholder = "name",
  valuePlaceholder = "value or $ref",
}: {
  rows: VarRow[];
  onChange: (rows: VarRow[]) => void;
  withTypes?: boolean;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const list = rows.length > 0 ? rows : [{ name: "", value: "" }];
  return (
    <div className="space-y-1.5">
      {list.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            className="h-7 w-20 font-mono text-xs"
            aria-invalid={row.name !== "" && !isIdentifier(row.name) ? true : undefined}
            title={
              row.name !== "" && !isIdentifier(row.name)
                ? "variable name must be a plain identifier (no $)"
                : undefined
            }
            value={row.name}
            placeholder={namePlaceholder}
            onChange={(e) =>
              onChange(list.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
            }
          />
          {withTypes && (
            <select
              className="h-7 w-[4.5rem] shrink-0 rounded-lg border border-input bg-transparent px-1 text-xs outline-none focus-visible:border-ring"
              value={row.type ?? "auto"}
              onChange={(e) =>
                onChange(list.map((r, j) => (j === i ? { ...r, type: e.target.value } : r)))
              }
            >
              {FLOW_VAR_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
          <Input
            className="h-7 min-w-0 flex-1 font-mono text-xs"
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) =>
              onChange(list.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove variable"
            disabled={list.length === 1}
            onClick={() => onChange(list.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...list, { name: "", value: "", type: "auto" }])}
      >
        <Plus className="h-3 w-3" /> Add variable
      </Button>
    </div>
  );
}

/** Self-contained row editor for a record (keeps rows while typing). */
export function KeyValueEditor({
  value,
  onChange,
  namePlaceholder,
  valuePlaceholder,
}: {
  value: Record<string, string> | undefined;
  onChange: (value: Record<string, string>) => void;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const [rows, setRows] = useState<VarRow[]>(() => recordToRows(value));
  const update = (next: VarRow[]) => {
    setRows(next);
    onChange(rowsToRecord(next));
  };
  return (
    <VariableRows
      rows={rows}
      onChange={update}
      namePlaceholder={namePlaceholder}
      valuePlaceholder={valuePlaceholder}
    />
  );
}
