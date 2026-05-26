import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Verdict =
  | "LOSSLESS"
  | "PROBABLY-LOSSY"
  | "UNCERTAIN"
  | "NOT-FLAC"
  | "UNKNOWN";

export const VERDICTS: Verdict[] = [
  "LOSSLESS",
  "PROBABLY-LOSSY",
  "UNCERTAIN",
  "NOT-FLAC",
  "UNKNOWN",
];

export interface ScanRow {
  verdict: Verdict;
  path: string;
  peak: number | null;
  sr: number | null;
  info: string;
}

export interface ScanReport {
  root: string;
  generated: string;
  rows: ScanRow[];
}

export interface ScanProgress {
  done: number;
  total: number;
  path: string;
  verdict: Verdict;
}

export interface FlacCount {
  fileCount: number;
  totalBytes: number;
}

export interface MirrorPair {
  artist: string;
  release: string;
}

export interface MirrorResult {
  created: number;
  skipped: number;
  errors: string[];
}

export async function scanLibrary(
  root: string,
  workers?: number,
): Promise<ScanReport> {
  return invoke<ScanReport>("scan_library", { root, workers: workers ?? null });
}

export async function countFlacFiles(root: string): Promise<FlacCount> {
  return invoke<FlacCount>("count_flac_files", { root });
}

export async function cancelScan(): Promise<void> {
  await invoke("cancel_scan");
}

export async function createMirrorTree(
  dest: string,
  sourceRoot: string,
  pairs: MirrorPair[],
  sudo: boolean,
): Promise<MirrorResult> {
  return invoke<MirrorResult>("create_mirror_tree", {
    dest,
    sourceRoot,
    pairs,
    sudo,
  });
}

export async function loadReport(): Promise<ScanReport | null> {
  return invoke<ScanReport | null>("load_report");
}

export async function saveReport(report: ScanReport): Promise<void> {
  return invoke("save_report", { report });
}

export async function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

export async function onScanProgress(
  cb: (p: ScanProgress) => void,
): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan-progress", (event) => cb(event.payload));
}

// ---- nostr reactions (kind:7 / kind:5 via Rust signing) ----

export interface RelayError {
  relay: string;
  error: string;
}

export interface ReactionResult {
  eventId: string;
  acceptedBy: string[];
  rejected: RelayError[];
}

export async function publishReaction(
  eventId: string,
  authorPk: string,
  targetKind: number,
  content: string,
): Promise<ReactionResult> {
  return invoke<ReactionResult>("publish_reaction", {
    eventId,
    authorPk,
    targetKind,
    content,
  });
}

export async function deleteReaction(
  reactionEventId: string,
): Promise<ReactionResult> {
  return invoke<ReactionResult>("delete_reaction", { reactionEventId });
}
