//! The config, coefficient and audio file folders: listing, storing, renaming,
//! deleting and zipping their files.

use crate::paths::file_in_folder;
use crate::validate::{self, DeviceTypes};
use crate::{legacy, paths, wav, yaml};
use serde_json::{Map, Value, json};
use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

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

/// What to find out about each file in a listing.
#[derive(Clone, Copy, Default)]
pub struct Details {
    pub stats: bool,
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

/// The visible files of a folder, sorted by name. A folder that does not
/// exist has no files; the backend warned about it at startup.
pub fn list_files(folder: &Path, details: Details, context: Option<&ConfigContext>) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut files: Vec<(String, Value)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            // `is_file` follows symlinks, like `os.path.isfile`.
            if name.starts_with('.') || !path.is_file() {
                return None;
            }
            let mut data = Map::new();
            data.insert("name".into(), json!(name));
            if details.stats
                && let Ok(meta) = std::fs::metadata(&path)
            {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                data.insert("lastModified".into(), json!(modified));
                data.insert("size".into(), json!(meta.len()));
            }
            if details.config
                && let Some(context) = context
            {
                config_file_details(&path, &mut data, context);
            }
            if details.wav && name.to_lowercase().ends_with(".wav") {
                wav_details(&path, &mut data);
            }
            Some((name, Value::Object(data)))
        })
        .collect();
    files.sort_by_key(|(name, _)| name.to_lowercase());
    files.into_iter().map(|(_, data)| data).collect()
}

pub fn list_file_names(folder: &Path) -> Vec<String> {
    list_files(folder, Details::default(), None)
        .into_iter()
        .filter_map(|file| file["name"].as_str().map(String::from))
        .collect()
}

fn single_error(message: &str) -> Value {
    json!([[[], message, "error"]])
}

fn config_file_details(path: &Path, data: &mut Map<String, Value>, context: &ConfigContext) {
    data.insert("title".into(), Value::Null);
    data.insert("description".into(), Value::Null);
    data.insert("version".into(), Value::Null);
    data.insert("valid".into(), json!(false));
    data.insert("errors".into(), Value::Null);
    let not_a_config = "This does not appear to be a CamillaDSP config file.";
    let text = match std::fs::read(path).map(String::from_utf8) {
        Ok(Ok(text)) => text,
        Ok(Err(_)) => {
            data.insert(
                "errors".into(),
                single_error("This does not appear to be a YAML file."),
            );
            return;
        }
        Err(err) => {
            data.insert("errors".into(), single_error(&format!("Error: {err}")));
            return;
        }
    };
    let parsed = match yaml::parse(&text) {
        Ok(parsed) => parsed.value,
        Err(err) => {
            let message = match err.location {
                Some((line, column)) => {
                    format!("This file has a YAML syntax error on line: {line}, column: {column}")
                }
                None => "This config file has a YAML syntax error.".to_string(),
            };
            data.insert("errors".into(), single_error(&message));
            return;
        }
    };
    if !parsed.is_object() {
        data.insert("errors".into(), single_error(not_a_config));
        return;
    }
    data.insert(
        "title".into(),
        parsed.get("title").cloned().unwrap_or_default(),
    );
    data.insert(
        "description".into(),
        parsed.get("description").cloned().unwrap_or_default(),
    );
    let version = legacy::identify_version(&parsed);
    data.insert("version".into(), json!(version));
    match version {
        None => {
            data.insert("errors".into(), single_error(not_a_config));
        }
        Some(legacy::CURRENT_VERSION) => {
            let mut config = parsed;
            paths::make_config_filter_paths_absolute(
                &mut config,
                context.config_dir,
                context.coeff_dir,
            );
            paths::make_audio_file_paths_absolute(&mut config, context.audiofiles_dir);
            let issues = validate::validate(config, context.device_types);
            let valid = !validate::has_errors(&issues);
            data.insert("valid".into(), json!(valid));
            if !issues.is_empty() {
                data.insert("errors".into(), Value::Array(issues));
            }
        }
        Some(older) => {
            data.insert(
                "errors".into(),
                single_error(&format!(
                    "This config is made for the previous version {older} of CamillaDSP."
                )),
            );
        }
    }
}

fn wav_details(path: &Path, data: &mut Map<String, Value>) {
    data.insert("samplerate".into(), Value::Null);
    data.insert("channels".into(), Value::Null);
    data.insert("sampleformat".into(), Value::Null);
    data.insert("duration".into(), Value::Null);
    data.insert("valid".into(), json!(false));
    let Some(info) = wav::read_info(path) else {
        return;
    };
    data.insert("samplerate".into(), json!(info.sample_rate));
    data.insert("channels".into(), json!(info.channels));
    data.insert("sampleformat".into(), json!(info.sample_format));
    if info.byte_rate > 0 {
        data.insert(
            "duration".into(),
            json!(info.data_length as f64 / info.byte_rate as f64),
        );
    }
    data.insert("valid".into(), json!(true));
}

pub fn delete_files(folder: &Path, files: &[String]) -> Result<(), String> {
    for file in files {
        let path = file_in_folder(folder, file)?;
        std::fs::remove_file(&path).map_err(|err| format!("Could not delete {file}: {err}"))?;
    }
    Ok(())
}

/// Rename a file within a folder, refusing to overwrite another one.
pub fn rename_file(folder: &Path, source: &str, target: &str) -> Result<(), String> {
    let source_path = file_in_folder(folder, source)?;
    let target_path = file_in_folder(folder, target)?;
    if target_path.is_file() {
        return Err(format!("File {target} already exists"));
    }
    std::fs::rename(&source_path, &target_path)
        .map_err(|err| format!("Could not rename {source}: {err}"))
}

/// A zip of some of the files in a folder.
pub fn zip_of_files(folder: &Path, files: &[String]) -> Result<Vec<u8>, String> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buffer);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    for name in files {
        let path = file_in_folder(folder, name)?;
        let data = std::fs::read(&path).map_err(|err| format!("Could not read {name}: {err}"))?;
        zip.start_file(name, options)
            .map_err(|err| err.to_string())?;
        zip.write_all(&data).map_err(|err| err.to_string())?;
    }
    zip.finish().map_err(|err| err.to_string())?;
    Ok(buffer.into_inner())
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
        let files = list_files(
            dir.path(),
            Details {
                stats: true,
                ..Default::default()
            },
            None,
        );
        let names: Vec<_> = files.iter().map(|f| f["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["A.txt", "b.txt"]);
        assert_eq!(files[0]["size"], 2);
        assert!(list_files(&dir.path().join("missing"), Details::default(), None).is_empty());
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
        let get = |name: &str| files.iter().find(|f| f["name"] == name).unwrap().clone();
        let eqapo = get("eqapo.yml");
        assert_eq!(eqapo["version"], Value::Null);
        assert_eq!(eqapo["valid"], false);
        assert_eq!(
            eqapo["errors"][0][1],
            "This does not appear to be a CamillaDSP config file."
        );
        assert!(
            get("broken.yml")["errors"][0][1]
                .as_str()
                .unwrap()
                .contains("YAML syntax error on line")
        );
        let good = get("good.yml");
        assert_eq!(good["valid"], true, "{good}");
        assert_eq!(good["title"], "Good");
        assert_eq!(good["errors"], Value::Null);
        assert_eq!(get("old.yml")["version"], 3);
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
