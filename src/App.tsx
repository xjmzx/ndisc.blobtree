import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { ScannerControls } from "./components/ScannerControls";
import { Filters, type FilterState } from "./components/Filters";
import { LibraryTree } from "./components/LibraryTree";
import { StatusBar } from "./components/StatusBar";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { FeedPanel } from "./components/FeedPanel";
import { NostrPanel } from "./components/NostrPanel";
import {
  loadReport,
  type ScanReport,
  type ScanRow,
  type Verdict,
} from "./lib/tauri";
import { loadIdentity, shortNpub, type Identity } from "./lib/nostr";

const DEFAULT_ROOT = "/data/music";
const THEME_KEY = "afqc-tauri.theme";
type Theme = "fizx" | "upleb";

function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "upleb" ? "upleb" : "fizx";
}

export default function App() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [root, setRoot] = useState<string>(DEFAULT_ROOT);
  const [filter, setFilter] = useState<FilterState>({ verdict: "All", search: "" });
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "warn" | "ok" | "alert" }>(
    { text: "ready", tone: "muted" },
  );
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Apply + persist theme.
  useEffect(() => {
    document.documentElement.classList.toggle("theme-upleb", theme === "upleb");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Resolve app version once.
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  // Hydrate identity from the OS keychain on mount.
  useEffect(() => {
    loadIdentity()
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, []);

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
      <header className="shrink-0 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === "fizx" ? "upleb" : "fizx"))}
            title={
              theme === "fizx"
                ? "Theme: fizx.uk — click to switch to upleb.uk"
                : "Theme: upleb.uk — click to switch to fizx.uk"
            }
            aria-label="Switch colour theme"
            className="text-3xl font-bold tracking-tight leading-none shrink-0
                       cursor-pointer transition-opacity hover:opacity-70"
          >
            <span className="text-accent">n</span>
            <span className="text-fg">disc</span>
            <span className="text-mauve">.blobtree</span>
          </button>
          {appVersion && (
            <span
              className="hidden md:inline-flex items-center px-2.5 py-2
                         rounded-md bg-surface text-mauve font-mono text-xs
                         shrink-0"
            >
              v{appVersion}
            </span>
          )}
        </div>
        <p className="text-sm text-muted mt-1 text-right hidden md:block">
          spectral high-frequency analysis<br />
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

        {/* Right column: Workspace · Listen (Nostr feed) · Publish stub */}
        <div className="flex flex-col gap-4 min-h-0 overflow-auto">
          <WorkspacePanel
            rows={filteredRows}
            libRoot={libRoot}
            anyFilter={anyFilter}
            onStatus={setStatus}
          />
          <FeedPanel identity={identity} />
          <NostrPanel identity={identity} setIdentity={setIdentity} />
        </div>
      </div>

      <StatusBar text={status.text} tone={status.tone} />

      <footer className="shrink-0 flex flex-wrap items-center justify-between
                         gap-x-8 gap-y-1 text-xs text-muted">
        <span>stack: Tauri 2 + React + TypeScript + Tailwind · matches smpl-tool / ndisc</span>
        {identity && (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="font-mono text-mauve" title={identity.npub}>
              {shortNpub(identity.npub)}
            </span>
            <span
              className="inline-flex items-center gap-1"
              title="secret key stored in OS keychain (libsecret on Linux)"
            >
              <Lock size={11} />
              <span>nsec in keychain</span>
            </span>
          </span>
        )}
      </footer>
    </div>
  );
}
