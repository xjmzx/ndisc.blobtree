// Tauri commands for audio-flac-quality-check-tauri.
//
// 1:1 port of the Python check_flac_quality.sh + flac_library_browser.py:
//   - scan_library: walks <root>/**/*.flac, runs ffprobe + ffmpeg high-pass
//     volumedetect per file in parallel, emits "scan-progress" events.
//   - load_report / save_report: JSON cache in Tauri app data dir.
//   - open_folder: xdg-open on the containing folder (double-click action).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::available_parallelism;

use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const HIGHPASS_HZ: u32 = 16_000;
const LOSSY_DB: f32 = -65.0;
const LOSSLESS_DB: f32 = -35.0;
const REPORT_FILENAME: &str = "last_scan.json";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    #[serde(rename = "LOSSLESS")]
    Lossless,
    #[serde(rename = "PROBABLY-LOSSY")]
    ProbablyLossy,
    #[serde(rename = "UNCERTAIN")]
    Uncertain,
    #[serde(rename = "NOT-FLAC")]
    NotFlac,
    #[serde(rename = "UNKNOWN")]
    Unknown,
}

#[derive(Serialize, Deserialize, Clone)]
struct ScanRow {
    verdict: Verdict,
    path: String,
    peak: Option<f32>,
    sr: Option<u32>,
    info: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ScanReport {
    root: String,
    generated: String,
    rows: Vec<ScanRow>,
}

#[derive(Serialize, Clone)]
struct ScanProgress {
    done: usize,
    total: usize,
    path: String,
    verdict: Verdict,
}

// ---- ffprobe + ffmpeg --------------------------------------------------

fn ffprobe_fields(path: &Path) -> (Option<String>, Option<u32>) {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_name,sample_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output();
    let Ok(out) = out else {
        return (None, None);
    };
    if !out.status.success() {
        return (None, None);
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let mut lines = s.lines();
    let codec = lines.next().map(str::trim).filter(|x| !x.is_empty()).map(String::from);
    let sr = lines.next().and_then(|s| s.trim().parse::<u32>().ok());
    (codec, sr)
}

fn measure_high_band_peak(path: &Path, cutoff_hz: u32, vol_re: &Regex) -> Option<f32> {
    let out = Command::new("ffmpeg")
        .args(["-nostdin", "-i"])
        .arg(path)
        .args([
            "-af",
            &format!("highpass=f={cutoff_hz},volumedetect"),
            "-f", "null", "-",
        ])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let caps = vol_re.captures(&stderr)?;
    caps.get(1)?.as_str().parse::<f32>().ok()
}

fn classify(path: &Path, vol_re: &Regex) -> ScanRow {
    let path_str = path.to_string_lossy().into_owned();
    let (codec, sr) = ffprobe_fields(path);
    let Some(codec) = codec else {
        return ScanRow {
            verdict: Verdict::Unknown,
            path: path_str,
            peak: None,
            sr: None,
            info: "ffprobe failed".into(),
        };
    };
    if codec != "flac" {
        return ScanRow {
            verdict: Verdict::NotFlac,
            path: path_str,
            peak: None,
            sr,
            info: format!("codec={codec}"),
        };
    }
    let Some(sr_val) = sr else {
        return ScanRow {
            verdict: Verdict::Unknown,
            path: path_str,
            peak: None,
            sr,
            info: "no sample rate".into(),
        };
    };

    // Low-rate safety: if the file's sample rate can't span 2× the cutoff,
    // drop the cutoff to a quarter of the rate (matches the Python).
    let cutoff = if sr_val < 2 * HIGHPASS_HZ {
        ((sr_val / 4).max(4000)) as u32
    } else {
        HIGHPASS_HZ
    };

    let peak = measure_high_band_peak(path, cutoff, vol_re);
    let Some(peak) = peak else {
        return ScanRow {
            verdict: Verdict::Unknown,
            path: path_str,
            peak: None,
            sr,
            info: "ffmpeg/volumedetect failed".into(),
        };
    };

    let info = format!("peak>{cutoff}Hz={peak:+.1}dB sr={sr_val}");
    let verdict = if peak <= LOSSY_DB {
        Verdict::ProbablyLossy
    } else if peak >= LOSSLESS_DB {
        Verdict::Lossless
    } else {
        Verdict::Uncertain
    };
    ScanRow {
        verdict,
        path: path_str,
        peak: Some(peak),
        sr,
        info,
    }
}

// ---- commands ---------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FlacCount {
    file_count: usize,
    total_bytes: u64,
}

#[tauri::command]
async fn count_flac_files(root: String) -> Result<FlacCount, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_pb = PathBuf::from(&root);
        if !root_pb.is_dir() {
            return Err(format!("not a directory: {root}"));
        }
        let mut file_count = 0usize;
        let mut total_bytes = 0u64;
        for entry in WalkDir::new(&root_pb).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let is_flac = entry
                .path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("flac"))
                .unwrap_or(false);
            if !is_flac {
                continue;
            }
            file_count += 1;
            if let Ok(meta) = entry.metadata() {
                total_bytes = total_bytes.saturating_add(meta.len());
            }
        }
        Ok(FlacCount { file_count, total_bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorPair {
    artist: String,
    release: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MirrorResult {
    created: usize,
    skipped: usize,
    errors: Vec<String>,
}

#[tauri::command]
async fn create_mirror_tree(
    dest: String,
    pairs: Vec<MirrorPair>,
) -> Result<MirrorResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest_pb = PathBuf::from(&dest);
        if dest_pb.exists() && !dest_pb.is_dir() {
            return Err(format!("destination exists and is not a directory: {dest}"));
        }
        fs::create_dir_all(&dest_pb)
            .map_err(|e| format!("create {}: {e}", dest_pb.display()))?;

        let mut created = 0usize;
        let mut skipped = 0usize;
        let mut errors: Vec<String> = Vec::new();
        for pair in pairs {
            // Strip any leading "/" or ".." from artist/release to keep the
            // resulting path strictly under `dest`.
            let artist = sanitize(&pair.artist);
            let release = sanitize(&pair.release);
            if artist.is_empty() || release.is_empty() {
                errors.push(format!("skipped empty pair: {:?}/{:?}", pair.artist, pair.release));
                continue;
            }
            let target = dest_pb.join(&artist).join(&release);
            if target.exists() {
                skipped += 1;
                continue;
            }
            match fs::create_dir_all(&target) {
                Ok(()) => created += 1,
                Err(e) => errors.push(format!("{}: {e}", target.display())),
            }
        }
        Ok(MirrorResult { created, skipped, errors })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn sanitize(component: &str) -> String {
    component
        .trim()
        .trim_matches('/')
        .replace("..", "_")
        .replace('\0', "")
}

#[tauri::command]
async fn scan_library(
    root: String,
    workers: Option<usize>,
    app: AppHandle,
) -> Result<ScanReport, String> {
    tauri::async_runtime::spawn_blocking(move || scan_inner(root, workers, app))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_inner(root: String, workers: Option<usize>, app: AppHandle) -> Result<ScanReport, String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let files: Vec<PathBuf> = WalkDir::new(&root_pb)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("flac"))
                    .unwrap_or(false)
        })
        .map(|e| e.path().to_path_buf())
        .collect();

    let total = files.len();
    if total == 0 {
        return Err(format!("no .flac files under {root}"));
    }

    let worker_count = workers
        .or_else(|| available_parallelism().ok().map(|n| (n.get() / 2).max(2)))
        .unwrap_or(2);

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .build()
        .map_err(|e| e.to_string())?;

    let done = AtomicUsize::new(0);
    let vol_re = Regex::new(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB").unwrap();

    let rows: Vec<ScanRow> = pool.install(|| {
        files
            .par_iter()
            .map(|p| {
                let row = classify(p, &vol_re);
                let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        done: d,
                        total,
                        path: row.path.clone(),
                        verdict: row.verdict,
                    },
                );
                row
            })
            .collect()
    });

    Ok(ScanReport {
        root,
        generated: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        rows,
    })
}

fn report_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    Ok(dir.join(REPORT_FILENAME))
}

#[tauri::command]
fn load_report(app: AppHandle) -> Result<Option<ScanReport>, String> {
    let p = report_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&p).map_err(|e| format!("read {}: {e}", p.display()))?;
    let report: ScanReport =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", p.display()))?;
    Ok(Some(report))
}

#[tauri::command]
fn save_report(report: ScanReport, app: AppHandle) -> Result<(), String> {
    let p = report_path(&app)?;
    let text = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    fs::write(&p, text).map_err(|e| format!("write {}: {e}", p.display()))
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("xdg-open {path}: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            count_flac_files,
            create_mirror_tree,
            load_report,
            save_report,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
