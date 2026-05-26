import { useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw, ScanLine, Square } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import {
  cancelScan,
  countFlacFiles,
  onScanProgress,
  saveReport,
  scanLibrary,
  type FlacCount,
  type ScanProgress,
  type ScanReport,
} from "../lib/tauri";

// Heuristic for the pre-scan ETA. cpu/2 workers each doing ~ffmpeg
// startup + decode ≈ 1–2 files/sec; tune by observation if it drifts
// from real-world scans.
const FILES_PER_SEC = 8;

type State =
  | { kind: "idle" }
  | { kind: "counting" }
  | { kind: "confirming"; count: FlacCount }
  | { kind: "scanning" };

interface ScannerControlsProps {
  root: string;
  setRoot: (s: string) => void;
  onReport: (r: ScanReport) => void;
  onStatus: (s: { text: string; tone: "muted" | "warn" | "ok" | "alert" }) => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60} min`;
}

export function ScannerControls({ root, setRoot, onReport, onStatus }: ScannerControlsProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  // Mirrors `cancelling` for the async closure in startScan — state would
  // be stale across the awaited scanLibrary call.
  const cancelledRef = useRef(false);

  // Ctrl+R triggers the count step (matches the Tk app's shortcut).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        requestScan();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, state.kind]);

  async function browse() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose music library root",
      defaultPath: root || undefined,
    });
    if (typeof picked === "string") setRoot(picked);
  }

  async function requestScan() {
    if (state.kind !== "idle" || !root.trim()) return;
    setState({ kind: "counting" });
    onStatus({ text: "counting files…", tone: "warn" });
    try {
      const count = await countFlacFiles(root.trim());
      if (count.fileCount === 0) {
        setState({ kind: "idle" });
        onStatus({ text: `no .flac files under ${root.trim()}`, tone: "alert" });
        return;
      }
      setState({ kind: "confirming", count });
      onStatus({
        text: `${count.fileCount.toLocaleString()} files (${formatBytes(count.totalBytes)}) — confirm to scan`,
        tone: "muted",
      });
    } catch (e) {
      setState({ kind: "idle" });
      onStatus({ text: `count failed: ${e}`, tone: "alert" });
    }
  }

  async function startScan() {
    if (state.kind !== "confirming") return;
    setState({ kind: "scanning" });
    setProgress(null);
    setCancelling(false);
    cancelledRef.current = false;
    onStatus({ text: "starting scan…", tone: "warn" });

    try {
      const unlisten = await onScanProgress((p) => setProgress(p));
      unlistenRef.current = unlisten;
      const report = await scanLibrary(root.trim());
      onReport(report);
      await saveReport(report);
      if (cancelledRef.current) {
        onStatus({
          text: `scan cancelled · ${report.rows.length.toLocaleString()} files scanned`,
          tone: "warn",
        });
      } else {
        onStatus({
          text: `scan complete · ${report.rows.length.toLocaleString()} files`,
          tone: "ok",
        });
      }
    } catch (e) {
      onStatus({ text: `scan failed: ${e}`, tone: "alert" });
    } finally {
      setState({ kind: "idle" });
      setProgress(null);
      setCancelling(false);
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  }

  async function stopScan() {
    if (state.kind !== "scanning" || cancelledRef.current) return;
    cancelledRef.current = true;
    setCancelling(true);
    try {
      await cancelScan();
    } catch (e) {
      // Best-effort — the flag may already be set by the time this runs.
      console.warn("cancel_scan failed", e);
    }
    onStatus({ text: "cancelling… waiting for in-flight files", tone: "muted" });
  }

  function cancelConfirm() {
    setState({ kind: "idle" });
    onStatus({ text: "scan cancelled", tone: "muted" });
  }

  const scanning = state.kind === "scanning";
  const busy = state.kind !== "idle";
  const pct = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;

  return (
    <Section title="Scanner" icon={<ScanLine size={16} />}>
      <div className="flex gap-2">
        <input
          type="text"
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && requestScan()}
          placeholder="/path/to/music"
          disabled={busy}
          className="flex-1 px-3 py-2 rounded-md bg-surface text-fg
                     placeholder:text-muted outline-none border border-transparent
                     focus:border-accent/50 disabled:opacity-50"
          spellCheck={false}
        />
        <button
          onClick={browse}
          disabled={busy}
          className="px-3 py-2 rounded-md bg-surface hover:bg-surfaceHover
                     text-fg disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-1.5"
          title="Browse for folder"
        >
          <FolderOpen size={14} />
          Browse
        </button>
        {scanning ? (
          <button
            onClick={stopScan}
            disabled={cancelling}
            className={cn(
              "px-3 py-2 rounded-md font-semibold",
              "flex items-center gap-1.5",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-alert/15 text-alert hover:bg-alert hover:text-bg transition-colors",
            )}
            title="Stop scan — in-flight files finish, no new ones start"
          >
            <Square size={14} className={cancelling ? "animate-pulse" : ""} />
            {cancelling ? "cancelling…" : "Stop"}
          </button>
        ) : (
          <button
            onClick={requestScan}
            disabled={busy || !root.trim()}
            className={cn(
              "px-3 py-2 rounded-md font-semibold",
              "flex items-center gap-1.5",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "bg-accent text-bg hover:opacity-90",
            )}
            title="Re-scan (Ctrl+R)"
          >
            <RefreshCw size={14} className={state.kind === "counting" ? "animate-spin" : ""} />
            {state.kind === "counting" ? "counting…" : "Re-scan"}
          </button>
        )}
      </div>

      {state.kind === "confirming" && (
        <div className="rounded-md bg-bg/50 px-3 py-2.5 space-y-2 text-xs">
          <div className="text-fg">
            <span className="font-semibold">{state.count.fileCount.toLocaleString()}</span> FLAC
            files · <span className="font-semibold">{formatBytes(state.count.totalBytes)}</span> ·
            estimated <span className="font-semibold">~{formatEta(Math.ceil(state.count.fileCount / FILES_PER_SEC))}</span>
            <span className="text-muted"> ({FILES_PER_SEC} files/sec heuristic)</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={startScan}
              className="px-3 py-1.5 rounded-md bg-accent text-bg font-semibold hover:opacity-90 text-xs"
            >
              Start scan
            </button>
            <button
              onClick={cancelConfirm}
              className="px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover text-fg text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {scanning && (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-muted font-mono truncate">
            {progress
              ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} · ${progress.path}`
              : "discovering files…"}
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
