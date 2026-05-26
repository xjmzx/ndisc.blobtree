import { useState } from "react";
import { FolderOpen, Scissors } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import type { ScanRow } from "../lib/tauri";

const SAMPLE_SECS = 10;

interface SamplerPanelProps {
  rows: ScanRow[];
  anyFilter: boolean;
  onStatus: (s: { text: string; tone: "muted" | "warn" | "ok" | "alert" }) => void;
}

export function SamplerPanel({ rows, anyFilter, onStatus }: SamplerPanelProps) {
  const [dest, setDest] = useState("");
  // Layout-only stubs — wired through to confirm the shape; backend lands next.
  const [running] = useState(false);
  const [progress] = useState<{ done: number; total: number; path: string } | null>(null);

  const count = rows.length;
  const canRun = !running && count > 0 && dest.trim() !== "";
  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;

  async function browse() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose sample destination",
      defaultPath: dest || undefined,
    });
    if (typeof picked === "string") setDest(picked);
  }

  function startSample() {
    if (!canRun) return;
    // TODO(logic): wire to Rust command that ffmpeg-extracts SAMPLE_SECS
    // per file in parallel, mirroring artist/release/track structure under
    // `dest`. Same cancel-flag + per-file timeout patterns as Scanner.
    onStatus({
      text: `sampler layout only — ${count.toLocaleString()} files × ${SAMPLE_SECS}s pending backend`,
      tone: "warn",
    });
  }

  return (
    <Section title="Sampler" icon={<Scissors size={16} />}>
      <p className="text-xs text-muted">
        Saves a {SAMPLE_SECS}-second sample of each track in the current filter view
        to a destination of your choice. Source: {anyFilter ? "filtered" : "full"} library.
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
        <button
          onClick={startSample}
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
      </div>

      {running && (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-muted font-mono truncate">
            {progress
              ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} · ${progress.path}`
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
    </Section>
  );
}
