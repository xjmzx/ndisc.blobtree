import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Lock, Radio } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { SimplePool } from "nostr-tools";
import { cn } from "./lib/cn";
import { ScannerControls } from "./components/ScannerControls";
import { SamplerPanel } from "./components/SamplerPanel";
import { Filters, type FilterState } from "./components/Filters";
import { LibraryTree } from "./components/LibraryTree";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { FeedPanel } from "./components/FeedPanel";
import { NostrPanel } from "./components/NostrPanel";
import {
  cancelSample,
  loadReport,
  onSampleProgress,
  sampleTracks,
  type SampleProgress,
  type ScanReport,
  type ScanRow,
  type Verdict,
} from "./lib/tauri";
import { loadIdentity, shortNpub, type Identity } from "./lib/nostr";
import { usePersistedString } from "./lib/usePersistedString";
import { sampleDestPath } from "./lib/paths";

const SAMPLE_SECS = 10;
const SAMPLE_START_OFFSET_SECS = 30;

const DEFAULT_ROOT = "/data/music";
const THEME_KEY = "afqc-tauri.theme";
const SCANNER_ROOT_KEY = "afqc-tauri.scanner.root";
// Single shared destination for processed outputs — the mirror tree
// scaffolds it (mkdir + optional pkexec), Sampler writes 10s clips into
// the same root, future panels (Opus transcode, waveform PNGs, …) can
// join the same shared state. Key kept as `workspace.dest` so existing
// persisted values carry over.
const WORKSPACE_DEST_KEY = "afqc-tauri.workspace.dest";
// Suite-aligned default relay set (matches smpl-tool). The full
// editable + persisted list is a follow-up; for now this constant is
// the single source of truth visible across FeedPanel + NostrPanel +
// the footer indicator. Rust's REACTION_RELAYS still has its own copy
// — wiring relays through publish_reaction/delete_reaction is part of
// the same follow-up.
const DEFAULT_RELAYS = [
  "wss://relay.fizx.uk",
  "wss://nos.lol",
  "wss://relay.primal.net",
];
const PROFILE_RELAYS = ["wss://relay.fizx.uk"];
type Theme = "fizx" | "upleb";

// Header status chip — tone-tinted background + text per tone.
// Enumerated literal classes so Tailwind JIT sees them at build time.
const TONE_CHIP: Record<"muted" | "warn" | "ok" | "alert", string> = {
  muted: "bg-surface/50 text-fg/80",
  warn: "bg-warn/15 text-warn",
  ok: "bg-ok/15 text-ok",
  alert: "bg-alert/15 text-alert",
};

interface ProfileMeta {
  name?: string;
  display_name?: string;
  nip05?: string;
}

function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "upleb" ? "upleb" : "fizx";
}

export default function App() {
  const [report, setReport] = useState<ScanReport | null>(null);
  // Persists across launches; last-loaded report or last-picked dir wins.
  const [root, setRoot] = usePersistedString(SCANNER_ROOT_KEY, DEFAULT_ROOT);
  // Shared destination — see WORKSPACE_DEST_KEY comment.
  const [workspaceDest, setWorkspaceDest] = usePersistedString(WORKSPACE_DEST_KEY, "");
  const [filter, setFilter] = useState<FilterState>({ verdict: "All", search: "" });
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "warn" | "ok" | "alert" }>(
    { text: "ready", tone: "muted" },
  );
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Sampler dispatch state — shared by the panel batch button and the
  // per-scope Scissors in LibraryTree. One in-flight batch at a time;
  // null when idle.
  const [sampling, setSampling] = useState<SampleProgress | null>(null);
  const samplingActive = useRef(false);
  const sampleCancelledRef = useRef(false);
  const sampleUnlisten = useRef<(() => void) | null>(null);

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

  // Best-effort profile fetch (kind:0 metadata) for display_name / name.
  // Mirrors ndisc's pattern. Silent on failure — npub stays as-is if the
  // relay has no metadata for this pubkey.
  useEffect(() => {
    if (!identity) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pool = new SimplePool();
        const event = await pool.get(PROFILE_RELAYS, {
          kinds: [0],
          authors: [identity.pk],
        });
        pool.close(PROFILE_RELAYS);
        if (cancelled || !event) return;
        try {
          setProfile(JSON.parse(event.content) as ProfileMeta);
        } catch {
          /* malformed metadata, leave profile as null */
        }
      } catch {
        /* best-effort fetch, leave profile as null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity?.pk]);

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

  // Single sample dispatch — used by both SamplerPanel's batch button and
  // LibraryTree's per-scope Scissors. Guards on dest + non-empty subset +
  // not-already-running, then mirrors Scanner's pattern (subscribe to
  // progress, await command, surface a summary status).
  async function runSample(label: string, tracks: ScanRow[]) {
    if (samplingActive.current) {
      setStatus({ text: "sample already running — stop it first", tone: "warn" });
      return;
    }
    const dest = workspaceDest.trim();
    if (!dest) {
      setStatus({ text: "set a workspace destination first", tone: "warn" });
      return;
    }
    if (tracks.length === 0) {
      setStatus({ text: "no tracks to sample", tone: "warn" });
      return;
    }
    const libRoot = report?.root ?? root;
    const items = tracks.map((t) => ({
      src: t.path,
      dest: sampleDestPath(t.path, libRoot, dest, SAMPLE_SECS),
    }));

    samplingActive.current = true;
    sampleCancelledRef.current = false;
    setSampling({ done: 0, total: tracks.length, path: "", outcome: "Created" });
    setStatus({
      text: `sampling ${tracks.length.toLocaleString()} tracks (${label}) — ${SAMPLE_SECS}s each → ${dest}`,
      tone: "warn",
    });

    try {
      const unlisten = await onSampleProgress((p) => setSampling(p));
      sampleUnlisten.current = unlisten;
      const result = await sampleTracks(items, SAMPLE_SECS, SAMPLE_START_OFFSET_SECS);
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created.toLocaleString()} created`);
      if (result.skipped > 0) parts.push(`${result.skipped.toLocaleString()} skipped`);
      if (result.failed > 0) parts.push(`${result.failed.toLocaleString()} failed`);
      if (result.timedOut > 0) parts.push(`${result.timedOut.toLocaleString()} timed out`);
      if (result.cancelled > 0) parts.push(`${result.cancelled.toLocaleString()} cancelled`);
      const summary = parts.join(" · ");
      if (sampleCancelledRef.current) {
        setStatus({ text: `sample cancelled — ${summary}`, tone: "warn" });
      } else if (result.failed + result.timedOut > 0) {
        setStatus({ text: `sample done with errors — ${summary}`, tone: "alert" });
      } else {
        setStatus({ text: `sample complete — ${summary}`, tone: "ok" });
      }
    } catch (e) {
      setStatus({ text: `sample failed: ${e}`, tone: "alert" });
    } finally {
      samplingActive.current = false;
      setSampling(null);
      sampleUnlisten.current?.();
      sampleUnlisten.current = null;
    }
  }

  async function stopSample() {
    if (!samplingActive.current || sampleCancelledRef.current) return;
    sampleCancelledRef.current = true;
    try {
      await cancelSample();
    } catch (e) {
      console.warn("cancel_sample failed", e);
    }
    setStatus({ text: "cancelling sample… waiting for in-flight files", tone: "muted" });
  }

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
      LOSSY: 0,
      UNKNOWN: 0,
    };
    if (report) for (const r of report.rows) c[r.verdict]++;
    return c;
  }, [report]);

  const libRoot = report?.root ?? root;
  const anyFilter = filter.verdict !== "All" || filter.search.trim() !== "";

  return (
    <div className="h-screen p-6 max-w-[1400px] mx-auto flex flex-col gap-4">
      <header className="shrink-0 rounded-lg bg-panel border border-surface/60
                         px-4 py-3 flex md:grid md:grid-cols-[1fr_auto_1fr]
                         items-start gap-4">
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
        {/*
          Last-scan module: date + file count + 4-segment proportional bar
          (LOSSLESS / PROBABLY-LOSSY / UNCERTAIN / Other). Lives in the
          middle grid column (1fr_auto_1fr) so it's centered between the
          title and the right edge.
          TODO: drive the bar from `filteredRows` instead of `counts` so it
          updates with the current filter — also rework the count line so
          it can show e.g. "4,222 / 9,744" when narrowed.
        */}
        {report && (
          <div className="hidden md:flex flex-col items-center gap-1.5 min-w-[520px] mt-1">
            <div className="text-xs text-muted font-mono">
              scan: {report.generated.slice(0, 10)} ·{" "}
              {report.rows.length.toLocaleString()} files
            </div>
            {(() => {
              const total = Math.max(1, report.rows.length);
              const seg = (n: number) => (100 * n) / total;
              return (
                <div className="w-full h-1.5 rounded-sm overflow-hidden bg-bg/60 flex">
                  <div
                    className="h-full bg-ok"
                    style={{ width: `${seg(counts.LOSSLESS)}%` }}
                    title={`LOSSLESS ${counts.LOSSLESS.toLocaleString()}`}
                  />
                  <div
                    className="h-full bg-alert"
                    style={{ width: `${seg(counts["PROBABLY-LOSSY"])}%` }}
                    title={`PROBABLY-LOSSY ${counts["PROBABLY-LOSSY"].toLocaleString()}`}
                  />
                  <div
                    className="h-full bg-warn"
                    style={{ width: `${seg(counts.UNCERTAIN)}%` }}
                    title={`UNCERTAIN ${counts.UNCERTAIN.toLocaleString()}`}
                  />
                  <div
                    className="h-full bg-mauve"
                    style={{ width: `${seg(counts.LOSSY)}%` }}
                    title={`LOSSY ${counts.LOSSY.toLocaleString()}`}
                  />
                  <div
                    className="h-full bg-muted"
                    style={{ width: `${seg(counts.UNKNOWN)}%` }}
                    title={`UNKNOWN ${counts.UNKNOWN.toLocaleString()}`}
                  />
                </div>
              );
            })()}
          </div>
        )}
        {/* Right grid slot — surfaces the current status as a tinted chip
            (muted / warn / ok / alert). Balances the 1fr title column so
            the middle module remains centered. */}
        <div className="hidden md:flex items-center justify-end mt-1">
          <span
            className={cn(
              "text-xs font-mono px-2.5 py-1 rounded-md truncate max-w-[420px]",
              TONE_CHIP[status.tone],
            )}
            title={status.text}
          >
            {status.text}
          </span>
        </div>
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
          <SamplerPanel
            rows={filteredRows}
            dest={workspaceDest}
            setDest={setWorkspaceDest}
            sampling={sampling}
            onSample={(tracks) =>
              runSample(anyFilter ? "filtered library" : "full library", tracks)
            }
            onCancelSample={stopSample}
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
            onSampleScope={(label, tracks) => runSample(label, tracks)}
          />
        </div>

        {/* Right column: Workspace · Listen (Nostr feed) · Publish stub */}
        <div className="flex flex-col gap-4 min-h-0 overflow-auto">
          <WorkspacePanel
            rows={filteredRows}
            libRoot={libRoot}
            anyFilter={anyFilter}
            dest={workspaceDest}
            setDest={setWorkspaceDest}
            onStatus={setStatus}
          />
          <FeedPanel identity={identity} relays={DEFAULT_RELAYS} />
          <NostrPanel
            identity={identity}
            setIdentity={setIdentity}
            relays={DEFAULT_RELAYS}
          />
        </div>
      </div>

      <footer className="shrink-0 rounded-lg bg-panel border border-surface/60
                         px-4 py-2 flex flex-wrap items-center justify-between
                         gap-x-8 gap-y-1 text-xs text-muted">
        <span>stack: Tauri 2 + React + TS + Tailwind</span>

        {/* Centered identity chip — middle child of a flex justify-between
            row, same pattern as ndisc's footer. */}
        {identity ? (
          <span className="inline-flex items-center gap-2 min-w-0">
            {(profile?.display_name || profile?.name) && (
              <span className="text-fg/80 truncate">
                {profile?.display_name || profile?.name}
              </span>
            )}
            <span className="font-mono text-mauve" title={identity.npub}>
              {shortNpub(identity.npub)}
            </span>
            <span
              className="inline-flex items-center gap-1 text-ok"
              title="signed in · nsec stored in OS keychain (libsecret on Linux)"
            >
              <Lock size={11} />
              <span>nsec stored in keychain</span>
            </span>
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-muted/80"
            title="No key in the OS keychain for this build. Load or generate one in the Publish · Nostr panel."
          >
            <KeyRound size={11} className="opacity-60" />
            <span>not signed in · no key in keychain</span>
          </span>
        )}

        {/* Relay indicator — small chip on the right of the footer,
            replacing the prior scan-info span. Currently mirrors the
            hardcoded constant; an editable + persisted list lives in the
            follow-up scope (see DEFAULT_RELAYS comment). */}
        <span
          className="inline-flex items-center gap-1.5 font-mono"
          title={DEFAULT_RELAYS.map((r) => r.replace(/^wss:\/\//, "")).join("\n")}
        >
          <Radio size={11} className="opacity-70" />
          <span>
            {DEFAULT_RELAYS[0].replace(/^wss:\/\//, "")}
            {DEFAULT_RELAYS.length > 1 && (
              <span className="text-muted/70"> +{DEFAULT_RELAYS.length - 1}</span>
            )}
          </span>
        </span>
      </footer>
    </div>
  );
}
