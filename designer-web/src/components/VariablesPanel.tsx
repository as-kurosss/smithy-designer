import { Braces } from "lucide-react";
import VariableRows, { type VarRow } from "./VariableRows";

export default function VariablesPanel({
  rows,
  onChange,
  path,
}: {
  rows: VarRow[];
  onChange: (rows: VarRow[]) => void;
  path: string;
}) {
  return (
    <div className="panel-scroll flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <Braces className="h-3.5 w-3.5 shrink-0" />
        Variables
        <span className="ml-auto min-w-0 truncate font-mono text-[10px] font-normal normal-case tracking-normal">
          {path}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <VariableRows rows={rows} onChange={onChange} withTypes />
      </div>
    </div>
  );
}
