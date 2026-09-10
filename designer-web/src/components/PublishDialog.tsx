import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ExternalLink, Upload, X } from "lucide-react";
import { publishFlow, type PublishResult } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SETTINGS_KEY = "smithy.publish";

interface PublishSettings {
  url: string;
  token: string;
  name: string;
  version: string;
  allowInsecure: boolean;
}

function defaults(): PublishSettings {
  return {
    url: "http://127.0.0.1:8000",
    token: "",
    name: "my-flow",
    version: "",
    allowInsecure: false,
  };
}

function loadSettings(): PublishSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...defaults(), ...(JSON.parse(raw) as Partial<PublishSettings>) };
    }
  } catch {
    /* ignore */
  }
  return defaults();
}

export default function PublishDialog({
  defaultName,
  onClose,
}: {
  defaultName: string;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PublishSettings>(() => {
    const loaded = loadSettings();
    return loaded.name === defaults().name && defaultName ? { ...loaded, name: defaultName } : loaded;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = (p: Partial<PublishSettings>) => setSettings((s) => ({ ...s, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const version = settings.version.trim() || `1.0.${Math.floor(Date.now() / 1000)}`;
      const res = await publishFlow({
        url: settings.url.trim(),
        token: settings.token.trim(),
        name: settings.name.trim(),
        version,
        allow_insecure: settings.allowInsecure,
      });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, version: "" }));
      } catch {
        /* ignore */
      }
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-card p-4 shadow-xl ring-1 ring-foreground/10"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4 text-emerald-600" />
            Publish to orchestrator
          </span>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">
              Published <span className="font-medium">{result.name}</span>{" "}
              <span className="font-mono text-xs">{result.version}</span> to{" "}
              <span className="font-mono text-xs">{result.orchestrator}</span>.
            </p>
            <p className="text-xs text-muted-foreground">
              The process is now on the Orchestrator tab — deploy it to an agent and run it there.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={!result.process_url}
                onClick={() => {
                  if (result.process_url) window.open(result.process_url, "_blank", "noopener");
                }}
              >
                <ExternalLink className="h-4 w-4" />
                Open in Orchestrator
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Orchestrator URL</span>
              <Input
                value={settings.url}
                onChange={(e) => patch({ url: e.target.value })}
                placeholder="http://127.0.0.1:8000"
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">API token (sct_…)</span>
              <Input
                type="password"
                value={settings.token}
                onChange={(e) => patch({ token: e.target.value })}
                placeholder="sct_…"
                required
              />
            </label>
            <div className="flex gap-3">
              <label className="block flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Pack name</span>
                <Input
                  value={settings.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  required
                />
              </label>
              <label className="block flex-1 space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Version</span>
                <Input
                  value={settings.version}
                  onChange={(e) => patch({ version: e.target.value })}
                  placeholder="1.0.0 (auto)"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={settings.allowInsecure}
                onChange={(e) => patch({ allowInsecure: e.target.checked })}
              />
              Allow plain http to a non-loopback orchestrator (token in cleartext)
            </label>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={busy}>
                <Upload className="h-4 w-4" />
                {busy ? "Publishing…" : "Publish"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
