import { useMemo, useState } from "react";
import { FolderOpen, FolderTree, Hammer, ShieldCheck } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { uniquePairs } from "../lib/paths";
import { createMirrorTree, type MirrorResult, type ScanRow } from "../lib/tauri";
import { usePersistedBool } from "../lib/usePersistedString";

const EXPANDED_KEY = "afqc-tauri.mirrortree.expanded";

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: MirrorResult }
  | { kind: "err"; message: string };

interface WorkspacePanelProps {
  rows: ScanRow[];
  libRoot: string;
  anyFilter: boolean;
  /** Shared workspace destination — also consumed by SamplerPanel. */
  dest: string;
  setDest: (v: string) => void;
  onStatus: (s: { text: string; tone: "muted" | "warn" | "ok" | "alert" }) => void;
}

export function WorkspacePanel({ rows, libRoot, anyFilter, dest, setDest, onStatus }: WorkspacePanelProps) {
  const [expanded, setExpanded] = usePersistedBool(EXPANDED_KEY, true);
  const [sudo, setSudo] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  const pairs = useMemo(() => uniquePairs(rows, libRoot), [rows, libRoot]);
  const artistCount = useMemo(() => new Set(pairs.map((p) => p.artist)).size, [pairs]);

  async function browse() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose mirror destination",
      defaultPath: dest || undefined,
    });
    if (typeof picked === "string") setDest(picked);
  }

  async function createMirror() {
    const target = dest.trim();
    if (!target || pairs.length === 0) return;
    setState({ kind: "running" });
    onStatus({
      text: sudo
        ? `mirroring ${pairs.length} folders (pkexec — watch for password prompt)…`
        : `mirroring ${pairs.length} folders…`,
      tone: "warn",
    });
    try {
      const result = await createMirrorTree(target, libRoot, pairs, sudo);
      setState({ kind: "done", result });
      const suffix = sudo ? " · chown/chmod matched to source" : "";
      onStatus({
        text:
          `mirror complete · created ${result.created}, skipped ${result.skipped}` +
          (result.errors.length ? `, ${result.errors.length} errors` : "") +
          suffix,
        tone: result.errors.length ? "warn" : "ok",
      });
    } catch (e) {
      setState({ kind: "err", message: String(e) });
      onStatus({ text: `mirror failed: ${e}`, tone: "alert" });
    }
  }

  const running = state.kind === "running";
  const canRun = !!dest.trim() && pairs.length > 0 && !running;

  return (
    <Section
      title="Mirror tree"
      icon={<FolderTree size={16} />}
      onTitleClick={() => setExpanded(!expanded)}
    >
      {expanded && (
        <>
      <p className="text-xs text-muted">
        Mirror the parent directory as:{" "}
        <code className="text-fg/80">/empty-mirror/artist/release/</code>
      </p>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">
          Destination
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="/path/to/workspace"
            disabled={running}
            className="flex-1 px-3 py-2 rounded-md bg-surface text-fg
                       placeholder:text-muted outline-none border border-transparent
                       focus:border-accent/50 disabled:opacity-50 text-xs font-mono"
            spellCheck={false}
          />
          <button
            onClick={browse}
            disabled={running}
            className="px-3 py-2 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center gap-1.5 text-xs"
            title="Browse for destination"
          >
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
      </div>

      <div className="rounded-md bg-bg/50 px-3 py-2 text-xs text-fg">
        <span className="font-semibold">{artistCount.toLocaleString()}</span> artist
        folder{artistCount === 1 ? "" : "s"},{" "}
        <span className="font-semibold">{pairs.length.toLocaleString()}</span> release
        {pairs.length === 1 ? "" : "s"},{" "}
        <span className="font-semibold">{rows.length.toLocaleString()}</span>{" "}
        {anyFilter ? "filtered " : ""}track{rows.length === 1 ? "" : "s"}
        {pairs.length === 0 && (
          <span className="block text-muted mt-1">
            Nothing to mirror — load a scan or clear the filter.
          </span>
        )}
      </div>

      <label
        className={cn(
          "flex items-center gap-2 text-xs cursor-pointer select-none",
          "px-2 py-1.5 rounded-md hover:bg-surface/30",
          running && "opacity-50 cursor-not-allowed",
        )}
        title="Run mkdir + chown + chmod through pkexec — one system password prompt for the batch. The destination tree's owner/group/mode will be set to match the source library root."
      >
        <input
          type="checkbox"
          checked={sudo}
          onChange={(e) => setSudo(e.target.checked)}
          disabled={running}
          className="accent-accent"
        />
        <ShieldCheck size={12} className={sudo ? "text-accent" : "text-muted"} />
        <span className={sudo ? "text-fg" : "text-muted"}>
          Use elevated permissions (pkexec)
        </span>
      </label>

      <button
        onClick={createMirror}
        disabled={!canRun}
        className={cn(
          "w-full px-3 py-2 rounded-md font-semibold",
          "flex items-center justify-center gap-2 text-xs",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "bg-accent text-bg hover:opacity-90",
        )}
      >
        <Hammer size={14} />
        {running ? "creating…" : "Create mirror"}
      </button>

      {state.kind === "done" && (
        <div className="text-xs space-y-1">
          <div className="flex gap-3 text-fg">
            <span className="text-ok">created {state.result.created}</span>
            <span className="text-muted">skipped {state.result.skipped}</span>
            {state.result.errors.length > 0 && (
              <span className="text-alert">{state.result.errors.length} errors</span>
            )}
          </div>
          {state.result.errors.length > 0 && (
            <pre className="text-[10px] text-alert font-mono whitespace-pre-wrap max-h-32 overflow-auto">
              {state.result.errors.slice(0, 20).join("\n")}
              {state.result.errors.length > 20 && `\n…and ${state.result.errors.length - 20} more`}
            </pre>
          )}
        </div>
      )}

      {state.kind === "err" && (
        <pre className="text-xs text-alert font-mono break-all whitespace-pre-wrap">
          {state.message}
        </pre>
      )}
        </>
      )}
    </Section>
  );
}
