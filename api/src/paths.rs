//! File paths in configs: resolving them against the configured folders,
//! making them GUI friendly again, and refusing the ones that point elsewhere.

use serde_json::Value;
use std::path::{Component, Path, PathBuf};

/// Lexical normalization, like Python's `os.path.normpath`.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match out.components().next_back() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                // `/..` is `/`
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => out.push(".."),
            },
            other => out.push(other),
        }
    }
    if out.as_os_str().is_empty() {
        out.push(".");
    }
    out
}

/// An absolute, lexically normalized path, with no symlinks followed.
fn absolute(path: &Path) -> PathBuf {
    normalize(&std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// Resolve symlinks like `os.path.realpath`: the part of the path that exists
/// is canonicalized, and the rest is appended as it is written.
pub fn realpath(path: &Path) -> PathBuf {
    let path = absolute(path);
    let mut existing = path.as_path();
    let mut rest = Vec::new();
    loop {
        if let Ok(canonical) = std::fs::canonicalize(existing) {
            let mut result = canonical;
            for part in rest.iter().rev() {
                result.push(part);
            }
            return normalize(&result);
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                existing = parent;
            }
            _ => return path,
        }
    }
}

/// Whether `path` is `folder` or inside it, comparing whole components.
pub fn is_path_in_folder(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
}

/// `path` relative to `folder`, if it is inside it.
///
/// The path is taken as written, with `.` and `..` resolved lexically, so a
/// symlink placed in the folder counts as inside it and keeps its name,
/// wherever it points. It is compared with the folder as written and as
/// resolved, for a path written with the folder's real location (`/private/tmp`
/// for `/tmp` on macOS). Failing both, the path is resolved too, for one that
/// reaches the folder through a symlink outside it.
fn relative_in_folder(path: &Path, folder: &Path) -> Option<PathBuf> {
    let path = absolute(path);
    let real_folder = realpath(folder);
    for folder in [absolute(folder), real_folder.clone()] {
        if is_path_in_folder(&path, &folder) {
            return Some(relpath(&path, &folder));
        }
    }
    let real_path = realpath(&path);
    is_path_in_folder(&real_path, &real_folder).then(|| relpath(&real_path, &real_folder))
}

/// The last part of a path, splitting on both `/` and `\` whatever the
/// platform, like `ntpath.basename`. Configs can come from Windows machines.
pub fn nt_basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// A file name with no folder in it.
pub fn is_bare(path: &str) -> bool {
    nt_basename(path) == path
}

/// The last component of a path, like `os.path.basename`.
pub fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// A path relative to `base`, like `os.path.relpath`, for two absolute paths.
pub fn relpath(path: &Path, base: &Path) -> PathBuf {
    let path = normalize(path);
    let base = normalize(base);
    let path_parts: Vec<_> = path.components().collect();
    let base_parts: Vec<_> = base.components().collect();
    let common = path_parts
        .iter()
        .zip(&base_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let mut out = PathBuf::new();
    for _ in common..base_parts.len() {
        out.push("..");
    }
    for part in &path_parts[common..] {
        out.push(part);
    }
    if out.as_os_str().is_empty() {
        out.push(".");
    }
    out
}

/// Join a folder and a plain file name, refusing anything with a separator in it.
pub fn file_in_folder(folder: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename may not contain any slashes/backslashes".to_string());
    }
    Ok(normalize(&folder.join(filename)))
}

/// Make a path absolute against `base`, leaving an absolute one as it is.
pub fn make_absolute(path: &str, base: &Path) -> String {
    if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        to_string(&normalize(&base.join(path)))
    }
}

pub fn to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Resolve a coefficient path: a bare file name is looked up in coeff_dir,
/// any other relative path in config_dir.
pub fn coeff_path_to_absolute(path: &str, config_dir: &Path, coeff_dir: &Path) -> String {
    if Path::new(path).is_absolute() {
        return path.to_string();
    }
    let base = if is_bare(path) { coeff_dir } else { config_dir };
    to_string(&normalize(&base.join(path)))
}

/// The other way: a file directly in coeff_dir becomes a bare name, anything
/// else a path relative to config_dir. That includes files in subfolders of
/// coeff_dir, since a relative path with a folder in it is resolved against
/// config_dir.
pub fn coeff_path_to_relative(path: &str, config_dir: &Path, coeff_dir: &Path) -> String {
    if !Path::new(path).is_absolute() {
        return path.to_string();
    }
    let normalized = normalize(Path::new(path));
    if normalized.parent() == Some(coeff_dir) {
        return basename(&to_string(&normalized));
    }
    to_string(&relpath(Path::new(path), config_dir))
}

/// A path is safe if it ends up inside configured_dir.
///
/// A bare file name always does, since that is what it is resolved against.
/// Anything else is resolved the way the rest of the backend resolves it, a
/// relative path against base_dir and an absolute path as it stands, and then
/// has to land inside configured_dir. Where a path points matters, not how it
/// is written: a config in `~/camilladsp/configs` referring to
/// `../coeffs/filter.raw` is the ordinary layout and lands in coeff_dir, while
/// `../../../etc/passwd` does not and is refused. A symlink in configured_dir
/// is inside it, wherever it points: the GUI cannot make one, so it was put
/// there on purpose.
/// Without a base_dir a relative path cannot be resolved, so it is refused.
pub fn path_is_safe(path: &str, configured_dir: Option<&Path>, base_dir: Option<&Path>) -> bool {
    if is_bare(path) {
        return true;
    }
    let Some(configured_dir) = configured_dir else {
        return false;
    };
    let resolved = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        match base_dir {
            Some(base) => base.join(path),
            None => return false,
        }
    };
    relative_in_folder(&resolved, configured_dir).is_some()
}

/// Make a path relative to `directory` if it is inside it, subfolders and all,
/// which is what relative paths are resolved against. A relative path outside
/// it is reduced to a bare file name, and an absolute one is left as it is.
fn to_path_in_folder(path: &str, directory: &Path) -> String {
    if let Some(relative) = relative_in_folder(&directory.join(path), directory) {
        return to_string(&relative);
    }
    if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        basename(path)
    }
}

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Whether a filter reads its coefficients from a file.
pub fn is_file_conv(filter: &Value) -> bool {
    str_of(filter, "type") == Some("Conv")
        && matches!(
            filter.get("parameters").and_then(|p| str_of(p, "type")),
            Some("Raw" | "Wav")
        )
}

/// Apply a conversion to the coefficient file path of a filter.
pub fn convert_filter_path(filter: &mut Value, conversion: &impl Fn(&str) -> String) {
    if !is_file_conv(filter) {
        return;
    }
    if let Some(Value::String(filename)) = filter["parameters"].get_mut("filename")
        && !filename.is_empty()
    {
        *filename = conversion(filename);
    }
}

/// Apply a conversion to every coefficient file path of a config.
pub fn convert_config_filter_paths(config: &mut Value, conversion: impl Fn(&str) -> String) {
    if let Some(filters) = config.get_mut("filters").and_then(Value::as_object_mut) {
        for filter in filters.values_mut() {
            convert_filter_path(filter, &conversion);
        }
    }
}

pub fn make_config_filter_paths_absolute(config: &mut Value, config_dir: &Path, coeff_dir: &Path) {
    convert_config_filter_paths(config, |path| {
        coeff_path_to_absolute(path, config_dir, coeff_dir)
    });
}

pub fn make_config_filter_paths_relative(config: &mut Value, config_dir: &Path, coeff_dir: &Path) {
    convert_config_filter_paths(config, |path| {
        coeff_path_to_relative(path, config_dir, coeff_dir)
    });
}

/// The capture device, if it reads from a file.
fn capture_file_device(config: &mut Value) -> Option<&mut Value> {
    let capture = config.get_mut("devices")?.get_mut("capture")?;
    matches!(str_of(capture, "type"), Some("WavFile" | "RawFile")).then_some(capture)
}

/// The playback device, if it writes to a file.
fn playback_file_device(config: &mut Value) -> Option<&mut Value> {
    let playback = config.get_mut("devices")?.get_mut("playback")?;
    (str_of(playback, "type") == Some("File")).then_some(playback)
}

fn convert_device_filename(device: Option<&mut Value>, conversion: impl Fn(&str) -> String) {
    if let Some(Value::String(filename)) = device.and_then(|d| d.get_mut("filename"))
        && !filename.is_empty()
    {
        *filename = conversion(filename);
    }
}

/// Resolve relative capture and playback file names against audiofiles_dir.
pub fn make_audio_file_paths_absolute(config: &mut Value, audiofiles_dir: Option<&Path>) {
    let Some(dir) = audiofiles_dir else {
        return;
    };
    convert_device_filename(capture_file_device(config), |path| make_absolute(path, dir));
    convert_device_filename(playback_file_device(config), |path| {
        make_absolute(path, dir)
    });
}

/// Show capture and playback files inside audiofiles_dir relative to it.
pub fn make_audio_file_paths_relative(config: &mut Value, audiofiles_dir: Option<&Path>) {
    let Some(dir) = audiofiles_dir else {
        return;
    };
    convert_device_filename(capture_file_device(config), |path| {
        to_path_in_folder(path, dir)
    });
    convert_device_filename(playback_file_device(config), |path| {
        to_path_in_folder(path, dir)
    });
}

/// Reduce every coefficient and audio file path to a bare file name. Used for
/// configs uploaded from elsewhere, where the folders they came from mean nothing.
pub fn strip_config_paths_to_bare_filenames(config: &mut Value) {
    convert_config_filter_paths(config, |path| nt_basename(path).to_string());
    convert_device_filename(capture_file_device(config), |path| {
        nt_basename(path).to_string()
    });
    convert_device_filename(playback_file_device(config), |path| {
        nt_basename(path).to_string()
    });
}

/// A file path in a config that points outside its configured folder.
#[derive(Debug, PartialEq)]
pub struct OutsidePath {
    /// The keys leading to the file name, from the top of the config.
    pub location: Vec<String>,
    pub filename: String,
}

/// The file paths in a config that point outside their configured folders.
///
/// Relative coefficient paths are resolved against config_dir, and relative
/// audio paths against audiofiles_dir, which is where each of them is resolved
/// when the config is actually used.
pub fn paths_outside_folders(
    config: &Value,
    coeff_dir: &Path,
    audiofiles_dir: Option<&Path>,
    config_dir: &Path,
) -> Vec<OutsidePath> {
    let mut offenders = Vec::new();
    if let Some(filters) = config.get("filters").and_then(Value::as_object) {
        for (name, filter) in filters {
            if !is_file_conv(filter) {
                continue;
            }
            if let Some(filename) = str_of(&filter["parameters"], "filename")
                && !filename.is_empty()
                && !path_is_safe(filename, Some(coeff_dir), Some(config_dir))
            {
                offenders.push(OutsidePath {
                    location: vec![
                        "filters".into(),
                        name.clone(),
                        "parameters".into(),
                        "filename".into(),
                    ],
                    filename: filename.to_string(),
                });
            }
        }
    }
    let devices = config.get("devices");
    let device = |side: &str, types: &[&str]| {
        devices
            .and_then(|d| d.get(side))
            .filter(|d| str_of(d, "type").is_some_and(|t| types.contains(&t)))
    };
    for (side, types) in [
        ("capture", &["WavFile", "RawFile"][..]),
        ("playback", &["File"][..]),
    ] {
        if let Some(filename) = device(side, types).and_then(|d| str_of(d, "filename"))
            && !filename.is_empty()
            && !path_is_safe(filename, audiofiles_dir, audiofiles_dir)
        {
            offenders.push(OutsidePath {
                location: vec!["devices".into(), side.into(), "filename".into()],
                filename: filename.to_string(),
            });
        }
    }
    offenders
}

/// The value at a location given as keys, if there is one.
pub fn value_at_mut<'a>(config: &'a mut Value, location: &[String]) -> Option<&'a mut Value> {
    location
        .iter()
        .try_fold(config, |value, key| value.get_mut(key.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_like_normpath() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(normalize(Path::new("/../a")), PathBuf::from("/a"));
        assert_eq!(normalize(Path::new("a/../../b")), PathBuf::from("../b"));
    }

    #[test]
    fn coeff_paths_round_trip() {
        let config_dir = Path::new("/c/configs");
        let coeff_dir = Path::new("/c/coeffs");
        assert_eq!(
            coeff_path_to_absolute("fir.wav", config_dir, coeff_dir),
            "/c/coeffs/fir.wav"
        );
        assert_eq!(
            coeff_path_to_absolute("../coeffs/sub/fir.wav", config_dir, coeff_dir),
            "/c/coeffs/sub/fir.wav"
        );
        assert_eq!(
            coeff_path_to_absolute("/abs/fir.wav", config_dir, coeff_dir),
            "/abs/fir.wav"
        );
        assert_eq!(
            coeff_path_to_relative("/c/coeffs/fir.wav", config_dir, coeff_dir),
            "fir.wav"
        );
        assert_eq!(
            coeff_path_to_relative("/c/other/fir.wav", config_dir, coeff_dir),
            "../other/fir.wav"
        );
        assert_eq!(
            coeff_path_to_relative("x/fir.wav", config_dir, coeff_dir),
            "x/fir.wav"
        );
    }

    #[test]
    fn coeff_paths_in_subfolders_round_trip() {
        let config_dir = Path::new("/c/configs");
        let coeff_dir = Path::new("/c/coeffs");
        let relative = coeff_path_to_relative("/c/coeffs/sub/fir.wav", config_dir, coeff_dir);
        assert_eq!(relative, "../coeffs/sub/fir.wav");
        assert_eq!(
            coeff_path_to_absolute(&relative, config_dir, coeff_dir),
            "/c/coeffs/sub/fir.wav"
        );
        assert_eq!(
            coeff_path_to_relative("/c/coeffs/sub/../fir.wav", config_dir, coeff_dir),
            "fir.wav"
        );
    }

    #[test]
    fn audio_paths_in_subfolders_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio");
        std::fs::create_dir_all(audio.join("sub")).unwrap();
        let input = to_string(&audio.join("sub/in.wav"));
        let output = to_string(&audio.join("sub/out.wav"));
        let mut config = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": input},
                "playback": {"type": "File", "filename": output},
            },
        });
        make_audio_file_paths_relative(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], "sub/in.wav");
        assert_eq!(config["devices"]["playback"]["filename"], "sub/out.wav");
        make_audio_file_paths_absolute(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], input.as_str());
        assert_eq!(config["devices"]["playback"]["filename"], output.as_str());
        assert_eq!(
            to_path_in_folder("/elsewhere/x.wav", &audio),
            "/elsewhere/x.wav"
        );
    }

    #[test]
    fn subfolders_do_not_escape() {
        let dir = tempfile::tempdir().unwrap();
        let configs = dir.path().join("configs");
        let coeffs = dir.path().join("coeffs");
        std::fs::create_dir_all(coeffs.join("sub")).unwrap();
        std::fs::create_dir_all(&configs).unwrap();
        let escaping = to_string(&coeffs.join("sub/../../secret.raw"));
        let relative = coeff_path_to_relative(&escaping, &configs, &coeffs);
        assert_eq!(relative, "../secret.raw");
        assert!(!path_is_safe(&relative, Some(&coeffs), Some(&configs)));
        assert!(path_is_safe(
            "../coeffs/sub/f.raw",
            Some(&coeffs),
            Some(&configs)
        ));
        assert!(!path_is_safe(
            "../coeffs/sub/../../f.raw",
            Some(&coeffs),
            Some(&configs)
        ));
        let audio = dir.path().join("audio");
        std::fs::create_dir_all(audio.join("sub")).unwrap();
        assert_eq!(to_path_in_folder("sub/../../x.wav", &audio), "x.wav");
        let audio = Some(audio.as_path());
        assert!(path_is_safe("sub/in.wav", audio, audio));
        assert!(!path_is_safe("sub/../../x.wav", audio, audio));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_the_folders_keep_their_names() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = dir.path().join("elsewhere");
        let audio = dir.path().join("audio");
        let configs = dir.path().join("configs");
        let coeffs = dir.path().join("coeffs");
        for folder in [
            &elsewhere,
            &audio.join("sub"),
            &configs,
            &coeffs.join("sub"),
        ] {
            std::fs::create_dir_all(folder).unwrap();
        }
        let song = elsewhere.join("song.wav");
        std::fs::write(&song, "x").unwrap();
        std::fs::write(elsewhere.join("f.raw"), "x").unwrap();
        symlink(&song, audio.join("current.wav")).unwrap();
        symlink(&song, audio.join("sub/current.wav")).unwrap();
        symlink(&elsewhere, audio.join("music")).unwrap();
        symlink(elsewhere.join("f.raw"), coeffs.join("sub/f.raw")).unwrap();

        let linked = to_string(&audio.join("sub/current.wav"));
        let mut config = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": to_string(&audio.join("current.wav"))},
                "playback": {"type": "File", "filename": linked},
            },
        });
        make_audio_file_paths_relative(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], "current.wav");
        assert_eq!(config["devices"]["playback"]["filename"], "sub/current.wav");
        assert_eq!(
            to_path_in_folder(&to_string(&audio.join("music/song.wav")), &audio),
            "music/song.wav"
        );

        let audio = Some(audio.as_path());
        assert!(path_is_safe("sub/current.wav", audio, audio));
        assert!(path_is_safe("music/song.wav", audio, audio));
        assert!(path_is_safe(&linked, audio, audio));
        assert!(path_is_safe(
            "../coeffs/sub/f.raw",
            Some(&coeffs),
            Some(&configs)
        ));
        make_audio_file_paths_absolute(&mut config, audio);
        assert_eq!(paths_outside_folders(&config, &coeffs, audio, &configs), []);

        // Walking out of the folder by name is still refused.
        assert!(!path_is_safe(
            "music/../../elsewhere/song.wav",
            audio,
            audio
        ));
        assert!(!path_is_safe("sub/../../elsewhere/song.wav", audio, audio));
        assert!(!path_is_safe(&to_string(&song), audio, audio));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_is_compared_like_with_like() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        let linked = dir.path().join("linked");
        std::fs::create_dir_all(real.join("sub")).unwrap();
        std::fs::write(real.join("sub/in.wav"), "x").unwrap();
        std::os::unix::fs::symlink(&real, &linked).unwrap();
        for (path, folder) in [(&real, &linked), (&linked, &linked), (&linked, &real)] {
            let input = to_string(&path.join("sub/in.wav"));
            assert_eq!(to_path_in_folder(&input, folder), "sub/in.wav");
            assert!(path_is_safe(&input, Some(folder), Some(folder)));
        }
        let outside = to_string(&linked.join("../x.wav"));
        assert!(!path_is_safe(&outside, Some(&linked), Some(&linked)));
        assert!(!path_is_safe(&outside, Some(&real), Some(&real)));
    }

    #[test]
    fn folder_check_compares_components() {
        assert!(is_path_in_folder(Path::new("/a/b/c"), Path::new("/a/b")));
        assert!(!is_path_in_folder(Path::new("/a/bc"), Path::new("/a/b")));
    }

    #[test]
    fn unsafe_paths_are_found() {
        let dir = tempfile::tempdir().unwrap();
        let configs = dir.path().join("configs");
        let coeffs = dir.path().join("coeffs");
        std::fs::create_dir_all(&configs).unwrap();
        std::fs::create_dir_all(&coeffs).unwrap();
        assert!(path_is_safe("f.raw", Some(&coeffs), Some(&configs)));
        assert!(path_is_safe(
            "../coeffs/f.raw",
            Some(&coeffs),
            Some(&configs)
        ));
        assert!(!path_is_safe(
            "../../../etc/passwd",
            Some(&coeffs),
            Some(&configs)
        ));
        assert!(!path_is_safe("/etc/passwd", Some(&coeffs), Some(&configs)));
        assert!(!path_is_safe("sub/f.raw", None, Some(&configs)));
        let config = json!({
            "filters": {
                "a": {"type": "Conv", "parameters": {"type": "Raw", "filename": "/etc/passwd"}},
                "b": {"type": "Conv", "parameters": {"type": "Wav", "filename": "ok.wav"}},
            },
            "devices": {"capture": {"type": "WavFile", "filename": "/tmp/x.wav"}},
        });
        let offenders = paths_outside_folders(&config, &coeffs, None, &configs);
        let filenames: Vec<&str> = offenders.iter().map(|o| o.filename.as_str()).collect();
        assert_eq!(filenames, vec!["/etc/passwd", "/tmp/x.wav"]);
        assert_eq!(
            offenders[1].location,
            vec!["devices", "capture", "filename"]
        );
    }

    #[test]
    fn uploaded_configs_get_bare_names() {
        let mut config = json!({
            "filters": {"a": {"type": "Conv", "parameters": {"type": "Raw", "filename": "C:\\x\\f.raw"}}},
            "devices": {"playback": {"type": "File", "filename": "/home/u/out.wav"}},
        });
        strip_config_paths_to_bare_filenames(&mut config);
        assert_eq!(config["filters"]["a"]["parameters"]["filename"], "f.raw");
        assert_eq!(config["devices"]["playback"]["filename"], "out.wav");
    }

    #[test]
    fn relpath_walks_up() {
        assert_eq!(
            relpath(Path::new("/a/b/c"), Path::new("/a/d")),
            PathBuf::from("../b/c")
        );
        assert_eq!(
            relpath(Path::new("/a"), Path::new("/a")),
            PathBuf::from(".")
        );
    }
}
