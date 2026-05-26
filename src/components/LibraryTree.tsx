import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderTree,
  Scissors,
} from "lucide-react";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { splitPath } from "../lib/paths";
import { openFolder, type ScanRow, type Verdict } from "../lib/tauri";

const VERDICT_COLOR: Record<Verdict, string> = {
  LOSSLESS: "text-ok",
  "PROBABLY-LOSSY": "text-alert",
  UNCERTAIN: "text-warn",
  LOSSY: "text-mauve",
  UNKNOWN: "text-muted",
};

interface TrackRow extends ScanRow {
  _artist: string;
  _album: string;
  _track: string;
}

interface Album {
  name: string;
  tracks: TrackRow[];
}

interface Artist {
  name: string;
  albums: Album[];
  totalTracks: number;
}

function group(rows: ScanRow[], root: string): Artist[] {
  const byArtist = new Map<string, Map<string, TrackRow[]>>();
  for (const r of rows) {
    const [artist, album, track] = splitPath(r.path, root);
    const albums = byArtist.get(artist) ?? new Map<string, TrackRow[]>();
    if (!byArtist.has(artist)) byArtist.set(artist, albums);
    const tracks = albums.get(album) ?? [];
    if (!albums.has(album)) albums.set(album, tracks);
    tracks.push({ ...r, _artist: artist, _album: album, _track: track });
  }
  const out: Artist[] = [];
  for (const [name, albumsMap] of byArtist) {
    const albums: Album[] = [];
    let totalTracks = 0;
    for (const [aname, tracks] of albumsMap) {
      tracks.sort((a, b) => a._track.toLowerCase().localeCompare(b._track.toLowerCase()));
      albums.push({ name: aname, tracks });
      totalTracks += tracks.length;
    }
    albums.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    out.push({ name, albums, totalTracks });
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

function countsFor(tracks: TrackRow[]): Record<Verdict, number> {
  const c: Record<Verdict, number> = {
    LOSSLESS: 0,
    "PROBABLY-LOSSY": 0,
    UNCERTAIN: 0,
    LOSSY: 0,
    UNKNOWN: 0,
  };
  for (const t of tracks) c[t.verdict]++;
  return c;
}

function breakdown(c: Record<Verdict, number>): string {
  const order: Verdict[] = ["LOSSLESS", "UNCERTAIN", "PROBABLY-LOSSY", "LOSSY", "UNKNOWN"];
  return order
    .filter((v) => c[v] > 0)
    .map((v) => `${c[v]} ${v.split("-")[0].toLowerCase()}`)
    .join("  ");
}

interface LibraryTreeProps {
  rows: ScanRow[];
  libRoot: string;
  anyFilter: boolean;
  onOpenStatus: (s: { text: string; tone: "muted" | "warn" | "ok" | "alert" }) => void;
  /**
   * Per-scope Sample action. `label` is the human-readable scope name
   * (artist name, or "artist / album"), used for confirmation copy +
   * status. `tracks` is the exact row subset to sample. Layout-only for
   * now — the implementation in App.tsx just emits a status message
   * until backend lands.
   */
  onSampleScope: (label: string, tracks: ScanRow[]) => void;
}

export function LibraryTree({ rows, libRoot, anyFilter, onOpenStatus, onSampleScope }: LibraryTreeProps) {
  const artists = useMemo(() => group(rows, libRoot), [rows, libRoot]);
  const [openArtists, setOpenArtists] = useState<Set<string>>(new Set());
  const [openAlbums, setOpenAlbums] = useState<Set<string>>(new Set());

  // When a filter is active, expand everything (matches Tk behaviour).
  useEffect(() => {
    if (anyFilter) {
      setOpenArtists(new Set(artists.map((a) => a.name)));
      setOpenAlbums(new Set(artists.flatMap((a) => a.albums.map((al) => `${a.name}//${al.name}`))));
    }
  }, [anyFilter, artists]);

  function toggleArtist(name: string) {
    const next = new Set(openArtists);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpenArtists(next);
  }
  function toggleAlbum(key: string) {
    const next = new Set(openAlbums);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenAlbums(next);
  }

  function expandAll() {
    setOpenArtists(new Set(artists.map((a) => a.name)));
    setOpenAlbums(
      new Set(artists.flatMap((a) => a.albums.map((al) => `${a.name}//${al.name}`))),
    );
  }
  function collapseAll() {
    setOpenArtists(new Set());
    setOpenAlbums(new Set());
  }

  async function openTrackFolder(row: TrackRow) {
    const full = `${libRoot.replace(/\/$/, "")}/${row._artist}/${row._album}/${row._track}`;
    const folder = full.split("/").slice(0, -1).join("/");
    try {
      await openFolder(folder);
      onOpenStatus({ text: `opened ${folder}`, tone: "muted" });
    } catch (e) {
      onOpenStatus({ text: `open failed: ${e}`, tone: "alert" });
    }
  }

  return (
    <Section
      title="Library"
      icon={<FolderTree size={16} />}
      className="flex-1 min-h-0"
      contentClassName="flex-1 min-h-0 flex flex-col"
    >
      <div className="flex items-center justify-end gap-1 shrink-0 -mt-1">
        <button
          onClick={collapseAll}
          disabled={artists.length === 0}
          title="Collapse all"
          className="px-2 py-1 rounded text-muted hover:text-fg hover:bg-surface/40
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsDownUp size={14} />
        </button>
        <button
          onClick={expandAll}
          disabled={artists.length === 0}
          title="Expand all"
          className="px-2 py-1 rounded text-muted hover:text-fg hover:bg-surface/40
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsUpDown size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded-md bg-bg/40 divide-y divide-surface/40">
        {artists.length === 0 && (
          <div className="h-full flex items-center justify-center text-center text-muted text-xs p-8">
            <span>
              No tracks to display.<br />
              Run a scan, or clear the active filter (Esc).
            </span>
          </div>
        )}
        {artists.map((artist) => {
          const isOpen = openArtists.has(artist.name);
          const allArtistTracks = artist.albums.flatMap((a) => a.tracks);
          const ac = countsFor(allArtistTracks);
          return (
            <div key={artist.name}>
              <div className="w-full flex items-center pr-2 py-1.5 hover:bg-surface/30">
                <button
                  onClick={() => toggleArtist(artist.name)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-3 text-left
                             text-accent font-semibold text-sm"
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="flex-1 truncate">{artist.name}</span>
                  <span className="text-xs text-muted font-normal">
                    {artist.albums.length} albums · {artist.totalTracks} tracks
                  </span>
                  <span className="text-xs text-muted font-normal hidden md:inline">
                    {breakdown(ac)}
                  </span>
                </button>
                <button
                  onClick={() => onSampleScope(artist.name, allArtistTracks)}
                  title={`Sample ${artist.totalTracks} tracks across ${artist.albums.length} albums — 10s each`}
                  className="ml-2 px-2 py-1 rounded text-muted hover:text-accent
                             hover:bg-surface/40 shrink-0"
                  aria-label={`Sample all tracks by ${artist.name}`}
                >
                  <Scissors size={12} />
                </button>
              </div>
              {isOpen &&
                artist.albums.map((album) => {
                  const key = `${artist.name}//${album.name}`;
                  const alOpen = openAlbums.has(key);
                  const albumCounts = countsFor(album.tracks);
                  return (
                    <div key={key}>
                      <div className="w-full flex items-center pr-2 py-1 hover:bg-surface/20">
                        <button
                          onClick={() => toggleAlbum(key)}
                          className="flex-1 min-w-0 flex items-center gap-2 pl-8 pr-2
                                     text-left text-fg italic text-sm"
                        >
                          {alOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span className="flex-1 truncate">{album.name}</span>
                          <span className="text-xs text-muted not-italic">
                            {album.tracks.length} tracks
                          </span>
                          <span className="text-xs text-muted not-italic hidden md:inline">
                            {breakdown(albumCounts)}
                          </span>
                        </button>
                        <button
                          onClick={() => onSampleScope(`${artist.name} / ${album.name}`, album.tracks)}
                          title={`Sample ${album.tracks.length} tracks from this release — 10s each`}
                          className="ml-2 px-2 py-1 rounded text-muted hover:text-accent
                                     hover:bg-surface/40 shrink-0"
                          aria-label={`Sample release ${album.name}`}
                        >
                          <Scissors size={12} />
                        </button>
                      </div>
                      {alOpen &&
                        album.tracks.map((t, i) => (
                          <div
                            key={t.path}
                            onDoubleClick={() => openTrackFolder(t)}
                            title={t.path}
                            className={cn(
                              "grid grid-cols-[1fr_120px_90px_70px] gap-2 items-center",
                              "pl-14 pr-3 py-0.5 text-xs font-mono cursor-pointer",
                              "hover:bg-surface/40",
                              i % 2 === 1 && "bg-bg/40",
                            )}
                          >
                            <span className="truncate text-fg/80">{t._track}</span>
                            <span className={cn(VERDICT_COLOR[t.verdict])}>{t.verdict}</span>
                            <span className="text-right text-muted">
                              {t.peak !== null ? `${t.peak >= 0 ? "+" : ""}${t.peak.toFixed(1)} dB` : ""}
                            </span>
                            <span className="text-right text-muted">
                              {t.sr ? `${t.sr.toLocaleString()} Hz` : ""}
                            </span>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
