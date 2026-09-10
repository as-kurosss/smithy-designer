import { Braces } from "lucide-react";
import VariableRows, { type VarRow } from "./VariableRows";

export default function VariablesPanel({
  rows,
  onChange,
  path,
  isMain,
}: {
  rows: VarRow[];
  onChange: (rows: VarRow[]) => void;
  path: string;
  isMain: boolean;
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
        <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
          {isMain ? (
            <>
              Name a variable with a{" "}
              <span className="font-mono font-semibold text-foreground">G_</span> prefix (e.g.{" "}
              <span className="font-mono">G_report_path</span>) to make it{" "}
              <span className="font-semibold text-foreground">global</span> — visible in every
              subflow at any depth.
            </>
          ) : (
            <>
              All variables here are <span className="font-semibold text-foreground">local</span>
              ; globals (<span className="font-mono">G_…</span>) from the main flow are readable.
            </>
          )}
        </p>
        <VariableRows rows={rows} onChange={onChange} withTypes />
      </div>
    </div>
  );
}
