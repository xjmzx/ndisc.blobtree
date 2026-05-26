import { FolderOpen, Scissors, Square } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import type { SampleProgress, ScanRow } from "../lib/tauri";
import { usePersistedBool } from "../lib/usePersistedString";

const SAMPLE_SECS = 10;
const EXPANDED_KEY = "afqc-tauri.destination.expanded";

interface SamplerPanelProps {
  rows: ScanRow[];
  /** Shared workspace destination — also set by WorkspacePanel. */
  dest: string;
  setDest: (v: string) => void;
  /** Live progress when a sample run is in flight; null when idle. */
  sampling: SampleProgress | null;
  /** Kick a batch over the given subset of rows. */
  onSample: (tracks: ScanRow[]) => void;
  /** Stop the running batch (in-flight ffmpegs finish, ≤60s). */
  onCancelSample: () => void;
}

export function SamplerPanel({
  rows,
  dest,
  setDest,
  sampling,
  onSample,
  onCancelSample,
}: SamplerPanelProps) {
  const [expanded, setExpanded] = usePersistedBool(EXPANDED_KEY, true);
  const running = sampling !== null;
  const count = rows.length;
  const canRun = !running && count > 0 && dest.trim() !== "";
  const pct = sampling ? Math.round((100 * sampling.done) / Math.max(1, sampling.total)) : 0;

  async function browse() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose sample destination",
      defaultPath: dest || undefined,
    });
    if (typeof picked === "string") setDest(picked);
  }

  return (
    <Section
      title="Destination"
      icon={<Scissors size={16} />}
      onTitleClick={() => setExpanded(!expanded)}
    >
      {expanded && (
        <>
      <p className="text-xs text-muted">
        Saves a {SAMPLE_SECS}-second sample of each track in the current filter view
        into the Mirror Tree.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="/path/to/samples"
          disabled={running}
          className="flex-1 px-3 py-2 rounded-md bg-surface text-fg
                     placeholder:text-muted outline-none border border-transparent
                     focus:border-accent/50 disabled:opacity-50"
          spellCheck={false}
        />
        <button
          onClick={browse}
          disabled={running}
          className="px-3 py-2 rounded-md bg-surface hover:bg-surfaceHover
                     text-fg disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-1.5"
          title="Browse for destination"
        >
          <FolderOpen size={14} />
          Browse
        </button>
        {running ? (
          <button
            onClick={onCancelSample}
            className={cn(
              "px-3 py-2 rounded-md font-semibold",
              "flex items-center gap-1.5",
              "bg-alert/15 text-alert hover:bg-alert hover:text-bg transition-colors",
            )}
            title="Stop sample — in-flight files finish, no new ones start"
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={() => onSample(rows)}
            disabled={!canRun}
            className={cn(
              "px-3 py-2 rounded-md font-semibold",
              "flex items-center gap-1.5",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-accent text-bg hover:opacity-90",
            )}
            title={
              count === 0
                ? "Scan the library first"
                : dest.trim() === ""
                  ? "Choose a destination directory"
                  : `Sample ${SAMPLE_SECS}s of each filtered file into ${dest}`
            }
          >
            <Scissors size={14} />
            {count > 0 ? `Sample ${count.toLocaleString()}` : "Sample"}
          </button>
        )}
      </div>

      {running && (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-muted font-mono truncate">
            {sampling && sampling.total > 0
              ? `${sampling.done.toLocaleString()} / ${sampling.total.toLocaleString()} · ${sampling.path || "preparing…"}`
              : "preparing…"}
          </div>
          <div className="h-px bg-muted/40" />
          <div className="h-0.5 rounded-full bg-bg/60 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
        </>
      )}
    </Section>
  );
}
