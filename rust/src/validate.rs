//! `POST /api/validateconfig`, validating with camilladsp's own code.

use camilladsp_config::config::{self, Issue, IssueKind, PathElement};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

/// Validate a config sent by the frontend. `None` if it is valid, otherwise
/// every issue as `[path, message, severity]`, the shape the Python backend
/// sends and the frontend's `Errors` reads.
pub fn validate(mut config: Value, config_dir: &Path, coeff_dir: &Path) -> Option<Value> {
    make_filter_paths_absolute(&mut config, config_dir, coeff_dir);
    let issues = match config::deserialize_config(config) {
        Err(issue) => vec![issue],
        Ok(mut conf) => match config::validate_config(&mut conf, None) {
            Ok(_impulses) => return None,
            Err(issues) => issues.into_vec(),
        },
    };
    Some(Value::Array(issues.iter().map(issue_to_json).collect()))
}

fn issue_to_json(issue: &Issue) -> Value {
    // A config can be edited before its coefficient files are uploaded, so the
    // GUI only warns about a missing file. CamillaDSP itself refuses it.
    let severity = match issue.kind {
        IssueKind::Invalid => "error",
        IssueKind::MissingFile => "warning",
    };
    let path: Vec<Value> = issue
        .path
        .iter()
        .map(|element| match element {
            PathElement::Key(key) => json!(key),
            PathElement::Index(index) => json!(index),
        })
        .collect();
    json!([path, issue.message, severity])
}

/// Resolve the coefficient file paths of Conv filters, like
/// `make_config_filter_paths_absolute` in `backend/filemanagement.py`: a bare
/// filename is looked up in coeff_dir, any other relative path in config_dir.
fn make_filter_paths_absolute(config: &mut Value, config_dir: &Path, coeff_dir: &Path) {
    let Some(filters) = config.get_mut("filters").and_then(Value::as_object_mut) else {
        return;
    };
    for filter in filters.values_mut() {
        if filter.get("type").and_then(Value::as_str) != Some("Conv") {
            continue;
        }
        let Some(parameters) = filter.get_mut("parameters").and_then(Value::as_object_mut) else {
            continue;
        };
        if !matches!(
            parameters.get("type").and_then(Value::as_str),
            Some("Raw" | "Wav")
        ) {
            continue;
        }
        if let Some(Value::String(filename)) = parameters.get_mut("filename")
            && !filename.is_empty()
        {
            *filename = coeff_path_to_absolute(filename, config_dir, coeff_dir)
                .to_string_lossy()
                .into_owned();
        }
    }
}

fn coeff_path_to_absolute(path: &str, config_dir: &Path, coeff_dir: &Path) -> PathBuf {
    let as_path = Path::new(path);
    if as_path.is_absolute() {
        return as_path.to_path_buf();
    }
    // Python checks ntpath.basename, so a backslash counts as a separator on
    // every platform.
    let bare = !path.contains('/') && !path.contains('\\');
    let base = if bare { coeff_dir } else { config_dir };
    normalize(&base.join(as_path))
}

/// Lexical normalization, like Python's `os.path.normpath`.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_names_resolve_in_coeff_dir() {
        let config_dir = Path::new("/c/configs");
        let coeff_dir = Path::new("/c/coeffs");
        assert_eq!(
            coeff_path_to_absolute("fir.wav", config_dir, coeff_dir),
            PathBuf::from("/c/coeffs/fir.wav")
        );
        assert_eq!(
            coeff_path_to_absolute("../coeffs/sub/fir.wav", config_dir, coeff_dir),
            PathBuf::from("/c/coeffs/sub/fir.wav")
        );
        assert_eq!(
            coeff_path_to_absolute("/abs/fir.wav", config_dir, coeff_dir),
            PathBuf::from("/abs/fir.wav")
        );
    }

    #[test]
    fn issues_have_paths_and_severity() {
        let config = json!({
            "devices": {
                "samplerate": 44100,
                "chunksize": 1024,
                "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
                "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
            },
            "filters": {
                "lp": {"type": "Biquad", "parameters": {"type": "Lowpass", "freq": -5, "q": 0.7}},
                "fir": {"type": "Conv", "parameters": {"type": "Wav", "filename": "nope.wav"}},
            },
            "pipeline": [
                {"type": "Filter", "channels": [0], "names": ["lp", "fir"]},
                {"type": "Filter", "channels": [5], "names": ["lp"]},
            ],
        });
        let issues = validate(config, Path::new("/tmp"), Path::new("/tmp")).unwrap();
        let issues = issues.as_array().unwrap();
        assert!(issues.len() >= 3, "{issues:#?}");
        let has = |path: Value, severity: &str| {
            issues.iter().any(|issue| issue[0] == path && issue[2] == severity)
        };
        assert!(has(json!(["filters", "lp", "parameters", "freq"]), "error"), "{issues:#?}");
        assert!(has(json!(["filters", "fir", "parameters", "filename"]), "warning"), "{issues:#?}");
    }
}
