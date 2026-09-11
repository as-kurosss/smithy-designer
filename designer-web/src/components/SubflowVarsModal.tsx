import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SmithcoreFlowNode } from "../types";
import { isIdentifier, recordToRows, rowsToRecord, type VarRow } from "./VariableRows";

function VarTable({
  value,
  onChange,
  nameHeader,
  valueHeader,
  namePlaceholder,
  valuePlaceholder,
}: {
  value: Record<string, string> | undefined;
  onChange: (value: Record<string, string>) => void;
  nameHeader: string;
  valueHeader: string;
  namePlaceholder: string;
  valuePlaceholder: string;
}) {
  const [rows, setRows] = useState<VarRow[]>(() => recordToRows(value));
  const update = (next: VarRow[]) => {
    setRows(next);
    onChange(rowsToRecord(next));
  };
  const list = rows.length > 0 ? rows : [{ name: "", value: "" }];
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1 text-left font-semibold">{nameHeader}</th>
            <th className="px-2 py-1 text-left font-semibold">{valueHeader}</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {list.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-1 align-middle">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    className="h-7 font-mono text-xs"
                    value={row.name}
                    placeholder={namePlaceholder}
                    aria-invalid={row.name !== "" && !isIdentifier(row.name) ? true : undefined}
                    onChange={(e) =>
                      update(list.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                  />
                </div>
              </td>
              <td className="p-1">
                <Input
                  className="h-7 font-mono text-xs"
                  value={row.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) =>
                    update(list.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                />
              </td>
              <td className="p-1 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove row"
                  disabled={list.length === 1}
                  onClick={() => update(list.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => update([...list, { name: "", value: "" }])}
        className="flex w-full items-center gap-1 border-t border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3 w-3" /> Add row
      </button>
    </div>
  );
}

export default function SubflowVarsModal({
  node,
  onPatch,
  onClose,
}: {
  node: SmithcoreFlowNode;
  onPatch: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const cfg = (node.data.config ?? {}) as Record<string, unknown>;
  const setKey = (key: "inputs" | "outputs", value: Record<string, string>) =>
    onPatch(node.id, { config: { ...cfg, [key]: value } });
  return (
    <Modal title="Subflow variables" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-semibold">Inputs</div>
          <VarTable
            value={cfg.inputs as Record<string, string> | undefined}
            onChange={(v) => setKey("inputs", v)}
            nameHeader="Variable"
            valueHeader="Value"
            namePlaceholder="var"
            valuePlaceholder="value or $ref"
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold">Outputs</div>
          <VarTable
            value={cfg.outputs as Record<string, string> | undefined}
            onChange={(v) => setKey("outputs", v)}
            nameHeader="Parent variable"
            valueHeader="Child variable"
            namePlaceholder="parent"
            valuePlaceholder="child"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
