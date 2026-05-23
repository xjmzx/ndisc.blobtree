import { useEffect, useMemo, useState } from "react";
import { ScannerControls } from "./components/ScannerControls";
import { Filters, type FilterState } from "./components/Filters";
import { LibraryTree } from "./components/LibraryTree";
import { StatusBar } from "./components/StatusBar";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { NostrPanel } from "./components/NostrPanel";
import {
  loadReport,
  type ScanReport,
  type ScanRow,
  type Verdict,
} from "./lib/tauri";

const DEFAULT_ROOT = "/data/music";

export default function App() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [root, setRoot] = useState<string>(DEFAULT_ROOT);
  const [filter, setFilter] = useState<FilterState>({ verdict: "All", search: "" });
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "warn" | "ok" | "alert" }>(
    { text: "ready", tone: "muted" },
  );

  // Hydrate the last saved report on mount.
  useEffect(() => {
    loadReport()
      .then((r) => {
        if (r) {
          setReport(r);
          setRoot(r.root);
          setStatus({
            text: `loaded ${r.rows.length.toLocaleString()} entries from last scan`,
            tone: "muted",
          });
        } else {
          setStatus({ text: "no saved report — click Re-scan", tone: "warn" });
        }
      })
      .catch((e) => setStatus({ text: `load failed: ${e}`, tone: "alert" }));
  }, []);

  // Esc clears filter + search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFilter({ verdict: "All", search: "" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredRows: ScanRow[] = useMemo(() => {
    if (!report) return [];
    const q = filter.search.trim().toLowerCase();
    return report.rows.filter((r) => {
      if (filter.verdict !== "All" && r.verdict !== filter.verdict) return false;
      if (q && !r.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [report, filter]);

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = {
      LOSSLESS: 0,
      "PROBABLY-LOSSY": 0,
      UNCERTAIN: 0,
      "NOT-FLAC": 0,
      UNKNOWN: 0,
    };
    if (report) for (const r of report.rows) c[r.verdict]++;
    return c;
  }, [report]);

  const libRoot = report?.root ?? root;
  const anyFilter = filter.verdict !== "All" || filter.search.trim() !== "";

  return (
    <div className="h-screen p-6 max-w-[1400px] mx-auto flex flex-col gap-4">
      <header className="shrink-0">
        <h1 className="text-3xl font-bold text-accent tracking-tight">
          FLAC<span className="text-fg"> Library Browser</span>
        </h1>
        <p className="text-sm text-muted mt-1">
          spectral high-frequency analysis · flag lossy-source FLAC files ·
          peak above 16&nbsp;kHz heuristic
        </p>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] gap-4 items-stretch">
        {/* Left column: scanner + filters + tree (tree fills remaining height) */}
        <div className="flex flex-col gap-4 min-w-0 min-h-0">
          <ScannerControls
            root={root}
            setRoot={setRoot}
            onReport={(r) => {
              setReport(r);
              setRoot(r.root);
            }}
            onStatus={setStatus}
          />
          <Filters
            filter={filter}
            setFilter={setFilter}
            counts={counts}
            total={report?.rows.length ?? 0}
          />
          <LibraryTree
            rows={filteredRows}
            libRoot={libRoot}
            anyFilter={anyFilter}
            onOpenStatus={setStatus}
          />
        </div>

        {/* Right column: Workspace (mirror tree) + Nostr placeholder */}
        <div className="flex flex-col gap-4 min-h-0 overflow-auto">
          <WorkspacePanel
            rows={filteredRows}
            libRoot={libRoot}
            anyFilter={anyFilter}
            onStatus={setStatus}
          />
          <NostrPanel />
        </div>
      </div>

      <StatusBar text={status.text} tone={status.tone} />

      <footer className="text-xs text-muted shrink-0">
        <span>stack: Tauri 2 + React + TypeScript + Tailwind · matches smpl-tool / ndisc</span>
      </footer>
    </div>
  );
}
