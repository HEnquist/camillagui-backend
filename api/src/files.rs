//! The config, coefficient and audio file folders: listing, storing, renaming,
//! deleting and zipping their files.

use crate::coeffs::{self, ConvFileType};
use crate::paths::file_in_folder;
use crate::validate::{self, DeviceTypes, ValidationIssue};
use crate::{legacy, paths, wav, yaml};
use camilladsp_schema::config::FileSampleFormat;
use camilladsp_schema::filters::read_coeff_file;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;

/// Refuse to write into a folder that does not exist, saying so.
pub fn require_directory(folder: &Path) -> Result<(), String> {
    if folder.is_dir() {
        Ok(())
    } else {
        Err(format!(
            "The directory {} does not exist. Create it and try again.",
            folder.display()
        ))
    }
}

/// What to find out about each file in a listing, beyond its name, size and
/// time.
#[derive(Clone, Copy, Default)]
pub struct Details {
    /// Title, description and validity, for config files.
    pub config: bool,
    /// Format and length, for wav files.
    pub wav: bool,
}

/// Where a listing finds the files config files refer to.
pub struct ConfigContext<'a> {
    pub config_dir: &'a Path,
    pub coeff_dir: &'a Path,
    pub audiofiles_dir: Option<&'a Path>,
    pub device_types: &'a DeviceTypes,
}

/// A file in a listing. What is known about it beyond its name, size and time
/// depends on the folder: configs have their title, version and validity, wav
/// files their format, and coefficient files their format and length, for wav
/// and text files. What is not known is left out.
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct FileInfo {
    pub name: String,
    /// The time of the last change, in seconds since the epoch.
    pub last_modified: u64,
    /// In bytes.
    pub size: u64,
    /// For a config, its title.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub title: Option<String>,
    /// For a config, its description.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub description: Option<String>,
    /// For a config, the CamillaDSP version it is for.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub version: Option<u32>,
    /// For a config, whether it is for an older CamillaDSP, and is migrated
    /// when loaded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub outdated: Option<bool>,
    /// For a config, whether it has no errors. For a wav file, and a wav or
    /// text coefficient file, whether CamillaDSP can read it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub valid: Option<bool>,
    /// For a config, whether the GUI can load it, migrating it first if it is
    /// for an older version. It may still have errors to fix in the GUI.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub loadable: Option<bool>,
    /// For a config, its errors and warnings. For a text coefficient file,
    /// why CamillaDSP cannot read it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub errors: Option<Vec<ValidationIssue>>,
    /// For a wav file, in Hz.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub samplerate: Option<usize>,
    /// For a wav file.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub channels: Option<usize>,
    /// For a wav file, the CamillaDSP name of its sample format. For a text
    /// coefficient file, `TEXT`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub sampleformat: Option<String>,
    /// For a wav file, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub duration: Option<f64>,
    /// For a coefficient file, the number of values per channel.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub length: Option<u64>,
}

/// The names and paths of the visible files of a folder, in no particular
/// order. A folder that does not exist has no files; the backend warned about
/// it at startup.
fn visible_files(folder: &Path) -> impl Iterator<Item = (String, PathBuf)> + use<> {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            // `is_file` follows symlinks, like `os.path.isfile`.
            (!name.starts_with('.') && path.is_file()).then_some((name, path))
        })
}

/// A hash of the names, sizes and change times of the visible files of a
/// folder, which changes when a file is added, removed, renamed or rewritten.
pub fn fingerprint(folder: &Path) -> u64 {
    let mut files: Vec<(String, u64, Option<SystemTime>)> = visible_files(folder)
        .map(|(name, path)| {
            let meta = std::fs::metadata(&path).ok();
            let size = meta.as_ref().map_or(0, |meta| meta.len());
            (name, size, meta.and_then(|meta| meta.modified().ok()))
        })
        .collect();
    files.sort();
    let mut hasher = DefaultHasher::new();
    files.hash(&mut hasher);
    hasher.finish()
}

/// The visible files of a folder, sorted by name.
pub fn list_files(
    folder: &Path,
    details: Details,
    context: Option<&ConfigContext>,
) -> Vec<FileInfo> {
    let mut files: Vec<FileInfo> = visible_files(folder)
        .map(|(name, path)| {
            let mut info = FileInfo::default();
            if let Ok(meta) = std::fs::metadata(&path) {
                info.last_modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs());
                info.size = meta.len();
            }
            if details.config
                && let Some(context) = context
            {
                config_file_details(&path, &mut info, context);
            }
            if details.wav && name.to_lowercase().ends_with(".wav") {
                wav_details(&path, &mut info);
            }
            info.name = name;
            info
        })
        .collect();
    files.sort_by_key(|info| info.name.to_lowercase());
    files
}

pub fn list_file_names(folder: &Path) -> Vec<String> {
    list_files(folder, Details::default(), None)
        .into_iter()
        .map(|file| file.name)
        .collect()
}

fn single_error(message: &str) -> Option<Vec<ValidationIssue>> {
    Some(vec![ValidationIssue::error(message)])
}

fn config_file_details(path: &Path, info: &mut FileInfo, context: &ConfigContext) {
    info.valid = Some(false);
    info.loadable = Some(false);
    let not_a_config = "This does not appear to be a CamillaDSP config file.";
    let text = match std::fs::read(path).map(String::from_utf8) {
        Ok(Ok(text)) => text,
        Ok(Err(_)) => {
            info.errors = single_error("This does not appear to be a YAML file.");
            return;
        }
        Err(err) => {
            info.errors = single_error(&format!("Error: {err}"));
            return;
        }
    };
    let parsed = match yaml::parse(&text) {
        Ok(parsed) if !parsed.nonfinite.is_empty() => {
            info.errors = single_error(&yaml::nonfinite_message(&parsed.nonfinite));
            return;
        }
        Ok(parsed) => parsed.value,
        Err(err) => {
            let message = match err.location {
                Some((line, column)) => {
                    format!("This file has a YAML syntax error on line: {line}, column: {column}")
                }
                None => "This config file has a YAML syntax error.".to_string(),
            };
            info.errors = single_error(&message);
            return;
        }
    };
    if !parsed.is_object() {
        info.errors = single_error(not_a_config);
        return;
    }
    let text_of = |key: &str| parsed.get(key).and_then(Value::as_str).map(String::from);
    info.title = text_of("title");
    info.description = text_of("description");
    let Some(version) = legacy::identify_version(&parsed) else {
        info.errors = single_error(not_a_config);
        return;
    };
    let outdated = version < legacy::CURRENT_VERSION;
    info.version = Some(version);
    info.outdated = Some(outdated);
    let mut issues = Vec::new();
    if outdated {
        issues.push(ValidationIssue::error(format!(
            "This config is made for the previous version {version} of CamillaDSP, \
            and is migrated when loaded."
        )));
    }
    // The issues are those of the config the GUI loads, migrated the same way.
    let mut config = parsed;
    legacy::migrate_if_older(&mut config);
    paths::make_config_filter_paths_absolute(&mut config, context.config_dir, context.coeff_dir);
    paths::make_audio_file_paths_absolute(&mut config, context.audiofiles_dir);
    match validate::validate_if_parses(config, context.device_types) {
        Ok(found) => {
            info.loadable = Some(true);
            issues.extend(found);
        }
        Err(issue) => issues.push(issue),
    }
    info.valid = Some(issues.is_empty());
    if !issues.is_empty() {
        info.errors = Some(issues);
    }
}

fn wav_details(path: &Path, info: &mut FileInfo) {
    let Some(wav) = wav::read_info(path) else {
        info.valid = Some(false);
        return;
    };
    info.valid = Some(true);
    info.samplerate = Some(wav.sample_rate);
    info.channels = Some(wav.channels);
    info.sampleformat = Some(wav.sample_format.to_string());
    if wav.byte_rate > 0 {
        info.duration = Some(wav.data_length as f64 / wav.byte_rate as f64);
    }
}

/// What is known about a coefficient file beyond its name, size and time.
#[derive(Clone, Debug, Default, PartialEq)]
struct CoeffDetails {
    sampleformat: Option<&'static str>,
    samplerate: Option<usize>,
    channels: Option<usize>,
    length: Option<u64>,
    /// Whether CamillaDSP can read it, for a wav or text file.
    valid: Option<bool>,
    /// Why CamillaDSP cannot read a text file.
    error: Option<String>,
}

impl CoeffDetails {
    /// Read the details of a wav or text file, the kinds the extension says
    /// they are. A raw file's values depend on the format the filter gives, so
    /// there is nothing to tell about it.
    fn read(path: &Path) -> Self {
        let defaults = coeffs::defaults_for_filter(&path.to_string_lossy());
        if defaults.subtype == Some(ConvFileType::Wav) {
            let Some(wav) = wav::read_info(path) else {
                return CoeffDetails {
                    valid: Some(false),
                    ..Default::default()
                };
            };
            return CoeffDetails {
                sampleformat: Some(wav.sample_format),
                samplerate: Some(wav.sample_rate),
                channels: Some(wav.channels),
                length: (wav.bytes_per_frame > 0)
                    .then(|| wav.data_length / u64::from(wav.bytes_per_frame)),
                valid: Some(true),
                error: None,
            };
        }
        if defaults.format != Some(FileSampleFormat::TEXT) {
            return CoeffDetails::default();
        }
        // The values CamillaDSP would read, with its rules for what is one.
        let full_path = path.to_string_lossy();
        let values = read_coeff_file(&full_path, &FileSampleFormat::TEXT, 0, 0);
        match values {
            Ok(values) => CoeffDetails {
                sampleformat: Some("TEXT"),
                length: Some(values.len() as u64),
                valid: Some(true),
                ..Default::default()
            },
            Err(err) => {
                // The row already says which file, the folder is noise.
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                CoeffDetails {
                    sampleformat: Some("TEXT"),
                    valid: Some(false),
                    error: Some(err.to_string().replace(&*full_path, &name)),
                    ..Default::default()
                }
            }
        }
    }

    fn apply(&self, info: &mut FileInfo) {
        info.sampleformat = self.sampleformat.map(String::from);
        info.samplerate = self.samplerate;
        info.channels = self.channels;
        info.length = self.length;
        info.valid = self.valid;
        info.errors = self
            .error
            .as_ref()
            .map(|message| vec![ValidationIssue::error(message)]);
    }
}

struct CachedDetails {
    size: u64,
    modified: Option<SystemTime>,
    details: CoeffDetails,
}

/// The details of the coefficient files, by name, kept for as long as a file
/// keeps its size and time. A text file is only known after parsing all of
/// it, which for a large filter on a Pi takes a noticeable part of a second,
/// so only new and changed files are read.
#[derive(Default)]
pub struct CoeffDetailsCache {
    entries: Mutex<HashMap<String, CachedDetails>>,
}

impl CoeffDetailsCache {
    /// Fill in the details of the files in a listing of `folder`, reading
    /// those not known yet. Files no longer in the listing are forgotten.
    pub fn fill(&self, folder: &Path, files: &mut [FileInfo]) {
        // Held while reading, so a second listing at the same time waits for
        // the files this one reads rather than reading them too.
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let mut kept = HashMap::with_capacity(files.len());
        for info in files.iter_mut() {
            let path = folder.join(&info.name);
            let meta = std::fs::metadata(&path).ok();
            let size = meta.as_ref().map_or(0, |meta| meta.len());
            let modified = meta.and_then(|meta| meta.modified().ok());
            let details = match entries.remove(&info.name) {
                Some(cached) if cached.size == size && cached.modified == modified => {
                    cached.details
                }
                _ => CoeffDetails::read(&path),
            };
            details.apply(info);
            let cached = CachedDetails {
                size,
                modified,
                details,
            };
            kept.insert(info.name.clone(), cached);
        }
        *entries = kept;
    }
}

pub fn delete_files(folder: &Path, files: &[String]) -> Result<(), String> {
    for file in files {
        let path = file_in_folder(folder, file)?;
        std::fs::remove_file(&path).map_err(|err| format!("Could not delete {file}: {err}"))?;
    }
    Ok(())
}

/// Rename a file within a folder, refusing to overwrite another one. On a
/// case-insensitive filesystem a change of case finds the file itself under
/// the new name, which is not another one: the canonical paths, which have
/// the case on disk, are then the same.
pub fn rename_file(folder: &Path, source: &str, target: &str) -> Result<(), String> {
    let source_path = file_in_folder(folder, source)?;
    let target_path = file_in_folder(folder, target)?;
    let same_file = matches!(
        (source_path.canonicalize(), target_path.canonicalize()),
        (Ok(a), Ok(b)) if a == b
    );
    if target_path.is_file() && !same_file {
        return Err(format!("File {target} already exists"));
    }
    std::fs::rename(&source_path, &target_path)
        .map_err(|err| format!("Could not rename {source}: {err}"))
}

/// The files of a folder to zip, each named once, with their paths. They are
/// checked before the zip starts, since once its first bytes are sent, a file
/// that cannot be read can only cut the download short.
pub fn files_to_zip(folder: &Path, names: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for name in names {
        if !seen.insert(name.as_str()) {
            continue;
        }
        let path = file_in_folder(folder, name)?;
        match File::open(&path).and_then(|file| file.metadata()) {
            Ok(meta) if meta.is_file() => files.push((name.clone(), path)),
            Ok(_) => return Err(format!("{name} is not a file")),
            // Windows does not open a folder as a file at all.
            Err(_) if path.is_dir() => return Err(format!("{name} is not a file")),
            Err(err) => return Err(format!("Could not read {name}: {err}")),
        }
    }
    Ok(files)
}

/// The file size from which a zip entry gets zip64 sizes. A little under
/// 4 GiB, since deflate can grow incompressible data a few bytes per block.
/// Offsets past 4 GiB get zip64 without it.
const ZIP64_SIZE: u64 = 0xFF00_0000;

/// Write a zip of files to `out` as it is made, a file at a time, so that it
/// never has to fit in memory. Audio files are best `Stored`: deflate gains
/// next to nothing on them, and costs a Raspberry Pi a lot of CPU.
pub fn write_zip(
    files: &[(String, PathBuf)],
    method: zip::CompressionMethod,
    out: &mut impl Write,
) -> std::io::Result<()> {
    let mut zip = zip::ZipWriter::new_stream(&mut *out);
    let options = zip::write::SimpleFileOptions::default().compression_method(method);
    for (name, path) in files {
        let mut file = File::open(path)?;
        // Zip64 only where it is needed: a Stored entry with zip64 data
        // descriptors does not extract with macOS `ditto`.
        let large = file.metadata()?.len() >= ZIP64_SIZE;
        zip.start_file(name.as_str(), options.large_file(large))?;
        std::io::copy(&mut file, &mut zip)?;
    }
    zip.finish()?;
    out.flush()
}

/// What an uploaded config file is stored as: a config with every coefficient
/// and audio path reduced to a bare file name, so that configs from other
/// machines work here. Anything that is not a config is stored unchanged.
pub fn sanitize_uploaded_config(content: &[u8]) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(content) else {
        return content.to_vec();
    };
    match yaml::parse(text) {
        Ok(parsed) if parsed.value.is_object() && parsed.nonfinite.is_empty() => {
            let mut config = parsed.value;
            paths::strip_config_paths_to_bare_filenames(&mut config);
            yaml::dump(&config).into_bytes()
        }
        _ => content.to_vec(),
    }
}

// ── The statefile ──────────────────────────────────────────────────────────

fn default_statefile() -> Value {
    json!({
        "config_path": null,
        "mute": [false, false, false, false, false],
        "volume": [0.0, 0.0, 0.0, 0.0, 0.0],
    })
}

/// The config path stored in a statefile.
pub fn read_statefile_config_path(statefile: &Path) -> Option<String> {
    let text = match std::fs::read_to_string(statefile) {
        Ok(text) => text,
        Err(err) => {
            log::error!(
                "Statefile could not be opened: {}, details: {err}",
                statefile.display()
            );
            return None;
        }
    };
    match yaml::parse(&text) {
        Ok(parsed) => parsed.value.get("config_path")?.as_str().map(String::from),
        Err(err) => {
            log::error!(
                "Invalid yaml syntax in statefile: {}, details: {err}",
                statefile.display()
            );
            None
        }
    }
}

/// Store a new config path in a statefile, keeping the rest of it.
pub fn update_statefile_config_path(statefile: &Path, config_path: &str) -> Result<(), String> {
    let mut state = match std::fs::read_to_string(statefile) {
        Ok(text) => match yaml::parse(&text) {
            Ok(parsed) if parsed.value.is_object() => parsed.value,
            _ => {
                log::error!("Invalid yaml syntax in statefile: {}", statefile.display());
                default_statefile()
            }
        },
        Err(err) => {
            log::error!(
                "Statefile could not be opened: {}, details: {err}",
                statefile.display()
            );
            default_statefile()
        }
    };
    state["config_path"] = json!(config_path);
    std::fs::write(statefile, yaml::dump(&state)).map_err(|err| {
        format!(
            "Failed to update statefile at {}: {err}",
            statefile.display()
        )
    })
}

/// The file name of a path in config_dir, `None` for a path anywhere else.
pub fn verify_path_in_config_dir(path: Option<&str>, config_dir: &Path) -> Option<String> {
    let Some(path) = path else {
        log::warn!("The config file path is None");
        return None;
    };
    let canonical = paths::realpath(Path::new(path));
    if paths::is_path_in_folder(&canonical, &paths::realpath(config_dir)) {
        return canonical
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
    }
    log::error!(
        "The config file path '{path}' is not in the config dir '{}'",
        config_dir.display()
    );
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_skips_hidden_files_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.txt"), "x").unwrap();
        std::fs::write(dir.path().join("A.txt"), "xy").unwrap();
        std::fs::write(dir.path().join(".hidden"), "x").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let files = list_files(dir.path(), Details::default(), None);
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["A.txt", "b.txt"]);
        assert_eq!(files[0].size, 2);
        assert!(list_files(&dir.path().join("missing"), Details::default(), None).is_empty());
    }

    #[test]
    fn fingerprint_follows_the_visible_files() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        let empty = fingerprint(folder);
        assert_eq!(fingerprint(&folder.join("missing")), empty);

        std::fs::write(folder.join("a.txt"), "x").unwrap();
        let added = fingerprint(folder);
        assert_ne!(added, empty);
        assert_eq!(fingerprint(folder), added);

        std::fs::write(folder.join(".hidden"), "x").unwrap();
        std::fs::create_dir(folder.join("sub")).unwrap();
        assert_eq!(fingerprint(folder), added);

        // The same size, only newer.
        let file = File::options()
            .write(true)
            .open(folder.join("a.txt"))
            .unwrap();
        let later =
            file.metadata().unwrap().modified().unwrap() + std::time::Duration::from_secs(5);
        file.set_modified(later).unwrap();
        let rewritten = fingerprint(folder);
        assert_ne!(rewritten, added);

        std::fs::write(folder.join("a.txt"), "xy").unwrap();
        let grown = fingerprint(folder);
        assert_ne!(grown, rewritten);

        std::fs::rename(folder.join("a.txt"), folder.join("b.txt")).unwrap();
        let renamed = fingerprint(folder);
        assert_ne!(renamed, grown);

        std::fs::remove_file(folder.join("b.txt")).unwrap();
        assert_eq!(fingerprint(folder), empty);
    }

    fn coeff_listing(cache: &CoeffDetailsCache, folder: &Path) -> HashMap<String, FileInfo> {
        let mut files = list_files(folder, Details::default(), None);
        cache.fill(folder, &mut files);
        files
            .into_iter()
            .map(|info| (info.name.clone(), info))
            .collect()
    }

    #[test]
    fn coeff_details() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        std::fs::write(
            folder.join("ir.wav"),
            crate::wav::tests::wav_bytes(3, 32, 2, 10),
        )
        .unwrap();
        std::fs::write(folder.join("broken.wav"), "not a wav file").unwrap();
        std::fs::write(folder.join("ir.txt"), "1.0\n-0.5\n 0.25 \n").unwrap();
        std::fs::write(folder.join("bad.txt"), "1.0\nnope\n").unwrap();
        std::fs::write(folder.join("ir.raw"), [0u8; 16]).unwrap();
        let files = coeff_listing(&CoeffDetailsCache::default(), folder);

        let wav = &files["ir.wav"];
        assert_eq!(wav.sampleformat.as_deref(), Some("F32_LE"));
        assert_eq!(wav.samplerate, Some(44100));
        assert_eq!(wav.channels, Some(2));
        assert_eq!(wav.length, Some(10));
        assert_eq!(wav.valid, Some(true));
        assert!(wav.errors.is_none());

        let broken = &files["broken.wav"];
        assert_eq!(broken.valid, Some(false));
        assert!(broken.length.is_none());

        let text = &files["ir.txt"];
        assert_eq!(text.sampleformat.as_deref(), Some("TEXT"));
        assert_eq!(text.length, Some(3));
        assert_eq!(text.valid, Some(true));
        assert!(text.channels.is_none() && text.samplerate.is_none());

        let bad = &files["bad.txt"];
        assert_eq!(bad.valid, Some(false));
        assert!(bad.length.is_none());
        let message = &bad.errors.as_ref().unwrap()[0].message;
        assert!(message.contains("line 2 of file 'bad.txt'"), "{message}");

        // A raw file's values depend on the format the filter gives.
        let raw = &files["ir.raw"];
        assert!(raw.sampleformat.is_none() && raw.length.is_none() && raw.valid.is_none());
    }

    #[test]
    fn coeff_details_are_read_again_only_when_a_file_changes() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path();
        let path = folder.join("ir.txt");
        std::fs::write(&path, "1.0\n2.0\n").unwrap();
        let cache = CoeffDetailsCache::default();
        assert_eq!(coeff_listing(&cache, folder)["ir.txt"].valid, Some(true));

        // The same size and time: the cached details, without reading it.
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, "1.0\nx.0\n").unwrap();
        let file = File::options().write(true).open(&path).unwrap();
        file.set_modified(modified).unwrap();
        assert_eq!(coeff_listing(&cache, folder)["ir.txt"].valid, Some(true));

        // A new time: read again.
        file.set_modified(modified + std::time::Duration::from_secs(5))
            .unwrap();
        assert_eq!(coeff_listing(&cache, folder)["ir.txt"].valid, Some(false));

        // A new size: read again.
        std::fs::write(&path, "1.0\n2.0\n3.0\n").unwrap();
        assert_eq!(coeff_listing(&cache, folder)["ir.txt"].length, Some(3));

        std::fs::remove_file(&path).unwrap();
        assert!(coeff_listing(&cache, folder).is_empty());
        assert!(cache.entries.lock().unwrap().is_empty());
    }

    #[test]
    fn config_details() {
        let dir = tempfile::tempdir().unwrap();
        let write = |name: &str, text: &str| std::fs::write(dir.path().join(name), text).unwrap();
        write(
            "eqapo.yml",
            "Preamp: -7.08 dB\nFilter 1: ON LSC Fc 105.0 Hz Gain 7.2 dB Q 0.70\n",
        );
        write("broken.yml", "a: [1, 2\n");
        write(
            "good.yml",
            "title: Good\ndevices: {samplerate: 44100, chunksize: 1024, capture: {type: Stdin, channels: 2, format: S16_LE}, playback: {type: Stdout, channels: 2, format: S16_LE}}\n",
        );
        write(
            "old.yml",
            "devices: {capture: {type: Stdin, channels: 2, format: S16LE}}\n",
        );
        write(
            "old_complete.yml",
            "devices: {samplerate: 44100, chunksize: 1024, capture: {type: Stdin, channels: 2, format: S16LE}, playback: {type: Stdout, channels: 2, format: S16LE}}\n",
        );
        write(
            "bad_mixer.yml",
            "devices: {samplerate: 44100, chunksize: 1024, capture: {type: Stdin, channels: 2, format: S16_LE}, playback: {type: Stdout, channels: 2, format: S16_LE}}\npipeline: [{type: Mixer, name: nosuchmixer}]\n",
        );
        write("nan.yml", "devices: {samplerate: .nan}\n");
        let types = DeviceTypes::default();
        let context = ConfigContext {
            config_dir: dir.path(),
            coeff_dir: dir.path(),
            audiofiles_dir: None,
            device_types: &types,
        };
        let details = Details {
            config: true,
            ..Default::default()
        };
        let files = list_files(dir.path(), details, Some(&context));
        let get = |name: &str| files.iter().find(|f| f.name == name).unwrap();
        let first_error = |name: &str| get(name).errors.as_ref().unwrap()[0].message.clone();
        let eqapo = get("eqapo.yml");
        assert_eq!(eqapo.version, None);
        assert_eq!(eqapo.valid, Some(false));
        assert_eq!(eqapo.loadable, Some(false));
        assert_eq!(
            first_error("eqapo.yml"),
            "This does not appear to be a CamillaDSP config file."
        );
        assert!(first_error("broken.yml").contains("YAML syntax error on line"));
        let good = get("good.yml");
        assert_eq!(good.valid, Some(true), "{good:?}");
        assert_eq!(good.loadable, Some(true));
        assert_eq!(good.outdated, Some(false));
        assert_eq!(good.title.as_deref(), Some("Good"));
        assert!(good.errors.is_none());

        // Errors that leave a config parsing are fixed in the GUI.
        let bad_mixer = get("bad_mixer.yml");
        assert_eq!(bad_mixer.valid, Some(false));
        assert_eq!(bad_mixer.loadable, Some(true), "{bad_mixer:?}");

        // An older config is judged as it will be once migrated.
        let old = get("old.yml");
        assert_eq!(old.version, Some(3));
        assert_eq!(old.loadable, Some(false), "{old:?}");
        let old_complete = get("old_complete.yml");
        assert_eq!(old_complete.version, Some(3));
        assert_eq!(old_complete.outdated, Some(true));
        assert_eq!(old_complete.valid, Some(false));
        assert_eq!(old_complete.loadable, Some(true), "{old_complete:?}");
        assert_eq!(
            first_error("old_complete.yml"),
            "This config is made for the previous version 3 of CamillaDSP, and is migrated when loaded."
        );
        assert_eq!(old_complete.errors.as_ref().unwrap().len(), 1);

        let nan = get("nan.yml");
        assert_eq!(nan.loadable, Some(false));
        assert!(
            first_error("nan.yml").contains("devices/samplerate"),
            "{nan:?}"
        );
    }

    #[test]
    fn rename_refuses_to_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a"), "1").unwrap();
        std::fs::write(dir.path().join("b"), "2").unwrap();
        assert_eq!(
            rename_file(dir.path(), "a", "b").unwrap_err(),
            "File b already exists"
        );
        rename_file(dir.path(), "a", "c").unwrap();
        assert!(dir.path().join("c").is_file());
        assert!(rename_file(dir.path(), "c", "../d").is_err());
    }

    /// Case-insensitive filesystems (APFS, NTFS) find `case.yml` under
    /// `Case.yml` too, which must not count as another file.
    #[test]
    fn rename_can_change_only_the_case() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("case.yml"), "1").unwrap();
        rename_file(dir.path(), "case.yml", "Case.yml").unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["Case.yml"]);
    }

    #[test]
    fn zips_are_checked_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "1").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let names = |names: &[&str]| {
            names
                .iter()
                .map(|name| name.to_string())
                .collect::<Vec<_>>()
        };
        let files = files_to_zip(dir.path(), &names(&["a.txt", "a.txt"])).unwrap();
        assert_eq!(files, [("a.txt".to_string(), dir.path().join("a.txt"))]);
        let missing = files_to_zip(dir.path(), &names(&["a.txt", "b.txt"])).unwrap_err();
        assert!(missing.starts_with("Could not read b.txt"), "{missing}");
        assert_eq!(
            files_to_zip(dir.path(), &names(&["sub"])).unwrap_err(),
            "sub is not a file"
        );
        assert!(files_to_zip(dir.path(), &names(&["../a.txt"])).is_err());
    }

    /// The entries of a zip: name, compression and content.
    fn unzip(bytes: &[u8]) -> Vec<(String, zip::CompressionMethod, Vec<u8>)> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        (0..archive.len())
            .map(|index| {
                let mut entry = archive.by_index(index).unwrap();
                let mut content = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut content).unwrap();
                (entry.name().to_string(), entry.compression(), content)
            })
            .collect()
    }

    /// A zip of some files in a folder, sent as a response body would be.
    async fn streamed_zip(
        folder: &Path,
        names: &[&str],
        method: zip::CompressionMethod,
    ) -> Vec<u8> {
        let names: Vec<String> = names.iter().map(|name| name.to_string()).collect();
        let files = files_to_zip(folder, &names).unwrap();
        let (mut writer, body) = crate::reply::BodyWriter::new();
        tokio::task::spawn_blocking(move || write_zip(&files, method, &mut writer).unwrap());
        axum::body::to_bytes(body, usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    #[tokio::test]
    async fn streamed_zip_unpacks_to_the_files() {
        let dir = tempfile::tempdir().unwrap();
        // Larger than the chunks that may wait, so the writer has to wait too.
        let audio: Vec<u8> = (0..1_000_000u32).map(|i| (i % 251) as u8).collect();
        let other_audio = vec![1u8; 1000];
        let coeff = "0.5\n0.25\n0.125\n".repeat(1000);
        std::fs::write(dir.path().join("track.wav"), &audio).unwrap();
        std::fs::write(dir.path().join("other.wav"), &other_audio).unwrap();
        std::fs::write(dir.path().join("coeff.txt"), &coeff).unwrap();
        let stored = zip::CompressionMethod::Stored;
        let audio_zip = streamed_zip(dir.path(), &["track.wav", "other.wav"], stored).await;
        assert_eq!(
            unzip(&audio_zip),
            [
                ("track.wav".to_string(), stored, audio),
                ("other.wav".to_string(), stored, other_audio),
            ]
        );
        let deflated = zip::CompressionMethod::Deflated;
        let coeff_zip = streamed_zip(dir.path(), &["coeff.txt"], deflated).await;
        assert!(coeff_zip.len() < coeff.len() / 10);
        assert_eq!(
            unzip(&coeff_zip),
            [("coeff.txt".to_string(), deflated, coeff.into_bytes())]
        );
    }

    #[test]
    fn streamed_zip_stops_when_the_client_goes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("big.wav"), vec![0u8; 1_000_000]).unwrap();
        let files = files_to_zip(dir.path(), &["big.wav".to_string()]).unwrap();
        let (mut writer, body) = crate::reply::BodyWriter::new();
        drop(body);
        let err = write_zip(&files, zip::CompressionMethod::Stored, &mut writer).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::BrokenPipe);
    }

    #[test]
    fn statefile_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let statefile = dir.path().join("state.yml");
        std::fs::write(&statefile, "config_path: /a.yml\nmute: [true]\n").unwrap();
        update_statefile_config_path(&statefile, "/b.yml").unwrap();
        assert_eq!(
            read_statefile_config_path(&statefile).as_deref(),
            Some("/b.yml")
        );
        let text = std::fs::read_to_string(&statefile).unwrap();
        assert!(text.contains("true"), "{text}");
    }

    #[test]
    fn uploaded_configs_are_sanitized() {
        let stored = sanitize_uploaded_config(
            b"filters:\n  f: {type: Conv, parameters: {type: Raw, filename: /x/y/f.raw}}\n",
        );
        let text = String::from_utf8(stored).unwrap();
        assert!(text.contains("filename: f.raw"), "{text}");
        assert_eq!(sanitize_uploaded_config(b"just text"), b"just text");
    }
}
