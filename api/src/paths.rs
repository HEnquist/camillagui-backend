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

/// Whether two path components name the same thing.
#[cfg(not(windows))]
fn same_component(a: Component, b: Component) -> bool {
    a == b
}

/// Whether two path components name the same thing. Windows names are case
/// insensitive, and `\\?\C:`, as `canonicalize` writes it, is the same drive
/// as `C:`. Only ASCII letters are folded: NTFS folds more, but taking two
/// names of one file for different files only refuses a path, never lets one
/// out.
#[cfg(windows)]
fn same_component(a: Component, b: Component) -> bool {
    use std::ffi::OsString;
    use std::path::Prefix;
    fn plain(component: Component) -> OsString {
        let Component::Prefix(prefix) = component else {
            return component.as_os_str().to_os_string();
        };
        match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => {
                OsString::from(format!("{}:", drive as char))
            }
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
                let mut plain = OsString::from(r"\\");
                plain.push(server);
                plain.push(r"\");
                plain.push(share);
                plain
            }
            _ => prefix.as_os_str().to_os_string(),
        }
    }
    std::mem::discriminant(&a) == std::mem::discriminant(&b)
        && plain(a).eq_ignore_ascii_case(plain(b))
}

/// Whether `path` is `folder` or inside it, comparing whole components.
pub fn is_path_in_folder(path: &Path, folder: &Path) -> bool {
    let mut parts = path.components();
    folder
        .components()
        .all(|part| parts.next().is_some_and(|own| same_component(own, part)))
}

/// Whether two paths name the same file or folder, compared like
/// `is_path_in_folder`.
fn is_same_path(a: &Path, b: &Path) -> bool {
    is_path_in_folder(a, b) && a.components().count() == b.components().count()
}

/// A path with a drive but no root, like `D:f.raw`, which Windows resolves
/// against the current folder of that drive. Joining it to a folder leaves it
/// as it is, so it is not relative to anything of ours.
fn is_drive_relative(path: &Path) -> bool {
    !path.is_absolute() && matches!(path.components().next(), Some(Component::Prefix(_)))
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

/// A file name with no folder in it. On Windows that rules out a drive too:
/// `D:secret.raw` has no separator, but joining it to a folder gives a file
/// on D:, not in the folder.
pub fn is_bare(path: &str) -> bool {
    nt_basename(path) == path && !is_drive_relative(Path::new(path))
}

/// The last component of a path, like `os.path.basename`.
pub fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// A path relative to `base`, like `os.path.relpath`, for two absolute paths.
/// A path on another Windows drive has no relative form, so it comes back as
/// it is.
pub fn relpath(path: &Path, base: &Path) -> PathBuf {
    let path = normalize(path);
    let base = normalize(base);
    let path_parts: Vec<_> = path.components().collect();
    let base_parts: Vec<_> = base.components().collect();
    let common = path_parts
        .iter()
        .zip(&base_parts)
        .take_while(|(a, b)| same_component(**a, **b))
        .count();
    if common == 0 {
        return path;
    }
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

/// Join a folder and a plain file name, refusing anything with a separator in
/// it, `.` and `..`, and on Windows a drive (`C:x.yml` joined to a folder is
/// `C:x.yml` in the working directory, `push` drops the folder). A name that
/// is one normal component is the only kind that stays in the folder.
pub fn file_in_folder(folder: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename may not contain any slashes/backslashes".to_string());
    }
    let mut components = Path::new(filename).components();
    if !matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    ) {
        return Err(format!("Not a valid file name: {filename}"));
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
    if normalized
        .parent()
        .is_some_and(|parent| is_same_path(parent, coeff_dir))
    {
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
/// Without a base_dir a relative path cannot be resolved, so it is refused,
/// and so is a Windows path relative to a drive's current folder (`D:f.raw`).
/// A Windows path with a root but no drive (`\etc\passwd`) is on base_dir's
/// drive, as joining it gives.
pub fn path_is_safe(path: &str, configured_dir: Option<&Path>, base_dir: Option<&Path>) -> bool {
    if is_bare(path) {
        return true;
    }
    let Some(configured_dir) = configured_dir else {
        return false;
    };
    if is_drive_relative(Path::new(path)) {
        return false;
    }
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

    /// A relative path written with `/`, as this system writes it.
    fn native(path: &str) -> String {
        to_string(&normalize(Path::new(path)))
    }

    /// A path in `folder`, written with `/`, as this system writes it.
    fn under(folder: &Path, path: &str) -> String {
        to_string(&normalize(&folder.join(path)))
    }

    #[test]
    fn coeff_paths_round_trip() {
        let (dir, config_dir, coeff_dir, _audio) = folders();
        let (config_dir, coeff_dir) = (config_dir.as_path(), coeff_dir.as_path());
        assert_eq!(
            coeff_path_to_absolute("fir.wav", config_dir, coeff_dir),
            under(coeff_dir, "fir.wav")
        );
        assert_eq!(
            coeff_path_to_absolute("../coeffs/sub/fir.wav", config_dir, coeff_dir),
            under(coeff_dir, "sub/fir.wav")
        );
        let elsewhere = under(dir.path(), "abs/fir.wav");
        assert_eq!(
            coeff_path_to_absolute(&elsewhere, config_dir, coeff_dir),
            elsewhere
        );
        assert_eq!(
            coeff_path_to_relative(&under(coeff_dir, "fir.wav"), config_dir, coeff_dir),
            "fir.wav"
        );
        assert_eq!(
            coeff_path_to_relative(&under(dir.path(), "other/fir.wav"), config_dir, coeff_dir),
            native("../other/fir.wav")
        );
        assert_eq!(
            coeff_path_to_relative("x/fir.wav", config_dir, coeff_dir),
            "x/fir.wav"
        );
    }

    #[test]
    fn coeff_paths_in_subfolders_round_trip() {
        let (_dir, config_dir, coeff_dir, _audio) = folders();
        let (config_dir, coeff_dir) = (config_dir.as_path(), coeff_dir.as_path());
        let absolute = under(coeff_dir, "sub/fir.wav");
        let relative = coeff_path_to_relative(&absolute, config_dir, coeff_dir);
        assert_eq!(relative, native("../coeffs/sub/fir.wav"));
        assert_eq!(
            coeff_path_to_absolute(&relative, config_dir, coeff_dir),
            absolute
        );
        let walking_back = to_string(&coeff_dir.join("sub/../fir.wav"));
        assert_eq!(
            coeff_path_to_relative(&walking_back, config_dir, coeff_dir),
            "fir.wav"
        );
    }

    #[test]
    fn audio_paths_in_subfolders_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio");
        std::fs::create_dir_all(audio.join("sub")).unwrap();
        let input = under(&audio, "sub/in.wav");
        let output = under(&audio, "sub/out.wav");
        let mut config = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": input},
                "playback": {"type": "File", "filename": output},
            },
        });
        make_audio_file_paths_relative(&mut config, Some(&audio));
        assert_eq!(
            config["devices"]["capture"]["filename"],
            native("sub/in.wav")
        );
        assert_eq!(
            config["devices"]["playback"]["filename"],
            native("sub/out.wav")
        );
        make_audio_file_paths_absolute(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], input.as_str());
        assert_eq!(config["devices"]["playback"]["filename"], output.as_str());
        let elsewhere = under(dir.path(), "elsewhere/x.wav");
        assert_eq!(to_path_in_folder(&elsewhere, &audio), elsewhere);
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
        assert_eq!(relative, native("../secret.raw"));
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

    /// Make a symlink to a file or a folder. Windows needs a privilege for it,
    /// which CI has, so without it the test is skipped.
    fn symlink(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        let made = if target.is_dir() {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        };
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink(target, link);
        match made {
            Ok(()) => true,
            Err(err) if cfg!(windows) => {
                eprintln!("skipped: cannot make symlinks here, {err}");
                false
            }
            Err(err) => panic!("cannot make a symlink: {err}"),
        }
    }

    #[test]
    fn symlinks_in_the_folders_keep_their_names() {
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
        if !symlink(&song, &audio.join("current.wav")) {
            return;
        }
        symlink(&song, &audio.join("sub/current.wav"));
        symlink(&elsewhere, &audio.join("music"));
        symlink(&elsewhere.join("f.raw"), &coeffs.join("sub/f.raw"));

        let linked = under(&audio, "sub/current.wav");
        let mut config = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": under(&audio, "current.wav")},
                "playback": {"type": "File", "filename": linked},
            },
        });
        make_audio_file_paths_relative(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], "current.wav");
        assert_eq!(
            config["devices"]["playback"]["filename"],
            native("sub/current.wav")
        );
        assert_eq!(
            to_path_in_folder(&under(&audio, "music/song.wav"), &audio),
            native("music/song.wav")
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

    #[test]
    fn a_linked_folder_is_compared_like_with_like() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        let linked = dir.path().join("linked");
        std::fs::create_dir_all(real.join("sub")).unwrap();
        std::fs::write(real.join("sub/in.wav"), "x").unwrap();
        if !symlink(&real, &linked) {
            return;
        }
        for (path, folder) in [(&real, &linked), (&linked, &linked), (&linked, &real)] {
            let input = under(path, "sub/in.wav");
            assert_eq!(to_path_in_folder(&input, folder), native("sub/in.wav"));
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

    /// A tempdir with `configs`, `coeffs` and `audio` folders side by side.
    fn folders() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let [configs, coeffs, audio] =
            ["configs", "coeffs", "audio"].map(|name| dir.path().join(name));
        for folder in [&configs, &coeffs, &audio] {
            std::fs::create_dir_all(folder).unwrap();
        }
        (dir, configs, coeffs, audio)
    }

    fn outside(location: &[&str], filename: &str) -> OutsidePath {
        OutsidePath {
            location: location.iter().map(|key| key.to_string()).collect(),
            filename: filename.to_string(),
        }
    }

    fn conv(kind: &str, filename: &str) -> Value {
        json!({"type": "Conv", "parameters": {"type": kind, "filename": filename}})
    }

    #[test]
    fn paths_without_folders() {
        assert!(path_is_safe("f.raw", None, None));
        assert!(!path_is_safe("/etc/passwd", None, None));
        let (_dir, _configs, coeffs, _audio) = folders();
        assert!(!path_is_safe("sub/f.raw", Some(&coeffs), None));
        // `is_bare` splits on both separators, so this is not a bare name on Unix either.
        assert!(!path_is_safe("sub\\f.raw", Some(&coeffs), None));
    }

    #[test]
    fn files_in_folders_stay_in_them() {
        let folder = Path::new("/c/configs");
        assert_eq!(
            file_in_folder(folder, "x.yml").unwrap(),
            Path::new("/c/configs/x.yml")
        );
        for name in ["", ".", "..", "a/b.yml", "a\\b.yml", "../x.yml"] {
            assert!(file_in_folder(folder, name).is_err(), "{name:?}");
        }
        // Only Windows has drives, a colon is just a character elsewhere.
        if cfg!(windows) {
            assert!(file_in_folder(folder, "C:x.yml").is_err());
            assert!(file_in_folder(folder, "D:x.yml").is_err());
            assert!(!is_bare("D:secret.raw"));
        } else {
            assert_eq!(
                file_in_folder(folder, "a:b.yml").unwrap(),
                Path::new("/c/configs/a:b.yml")
            );
            assert!(is_bare("a:b.yml"));
        }
    }

    #[test]
    fn paths_into_neighbouring_folders_are_unsafe() {
        let (dir, configs, coeffs, _audio) = folders();
        std::fs::create_dir_all(dir.path().join("coeffs-elsewhere")).unwrap();
        let (coeffs, configs) = (Some(coeffs.as_path()), Some(configs.as_path()));
        assert!(!path_is_safe("../audio/x.wav", coeffs, configs));
        assert!(!path_is_safe("../coeffs-elsewhere/f.raw", coeffs, configs));
    }

    #[test]
    fn absolute_paths_are_safe_where_they_land() {
        let (_dir, configs, coeffs, _audio) = folders();
        let inside = to_string(&coeffs.join("f.raw"));
        let escaping = to_string(&coeffs.join("../../../etc/shadow"));
        assert!(path_is_safe(&inside, Some(&coeffs), Some(&configs)));
        assert!(!path_is_safe(&escaping, Some(&coeffs), Some(&configs)));
    }

    #[test]
    fn audio_paths_in_the_folder_round_trip() {
        let (_dir, _configs, _coeffs, audio) = folders();
        for capture_type in ["WavFile", "RawFile"] {
            let mut config = json!({
                "devices": {
                    "capture": {"type": capture_type, "filename": "in.wav"},
                    "playback": {"type": "File", "filename": "sub/out.wav"},
                },
            });
            // Already relative to the folder, so kept, with this system's
            // separators.
            make_audio_file_paths_relative(&mut config, Some(&audio));
            assert_eq!(config["devices"]["capture"]["filename"], "in.wav");
            assert_eq!(
                config["devices"]["playback"]["filename"],
                native("sub/out.wav")
            );
            make_audio_file_paths_absolute(&mut config, Some(&audio));
            assert_eq!(
                config["devices"]["capture"]["filename"],
                under(&audio, "in.wav")
            );
            assert_eq!(
                config["devices"]["playback"]["filename"],
                under(&audio, "sub/out.wav")
            );
            make_audio_file_paths_relative(&mut config, Some(&audio));
            assert_eq!(config["devices"]["capture"]["filename"], "in.wav");
            assert_eq!(
                config["devices"]["playback"]["filename"],
                native("sub/out.wav")
            );
        }
    }

    #[test]
    fn absolute_audio_paths_stay_absolute() {
        let (dir, _configs, _coeffs, audio) = folders();
        let original = json!({
            "devices": {"capture": {"type": "WavFile", "filename": under(dir.path(), "elsewhere/in.wav")}},
        });
        let mut config = original.clone();
        make_audio_file_paths_absolute(&mut config, Some(&audio));
        assert_eq!(config, original);
    }

    #[test]
    fn audio_paths_need_a_file_device_and_a_folder() {
        let (_dir, _configs, _coeffs, audio) = folders();
        // Names that would change if the devices were file devices: the
        // capture one going absolute, the playback one coming back bare.
        let in_folder = to_string(&audio.join("out.wav"));
        let other_devices = json!({
            "devices": {
                "capture": {"type": "Alsa", "channels": 2, "device": "hw:0", "filename": "in.wav"},
                "playback": {"type": "Stdout", "channels": 2, "format": "S32_LE", "filename": in_folder},
            },
        });
        let no_folder = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": "in.wav"},
                "playback": {"type": "File", "filename": in_folder},
            },
        });
        for (original, folder) in [(other_devices, Some(audio.as_path())), (no_folder, None)] {
            let mut config = original.clone();
            make_audio_file_paths_absolute(&mut config, folder);
            assert_eq!(config, original);
            make_audio_file_paths_relative(&mut config, folder);
            assert_eq!(config, original);
        }
    }

    #[test]
    fn coeff_paths_outside_the_folder_are_found() {
        let (_dir, configs, coeffs, audio) = folders();
        let config = json!({
            "filters": {
                "absolute": conv("Raw", &to_string(&coeffs.join("f.raw"))),
                "relative": conv("Wav", "../coeffs/f.wav"),
                "escaping": conv("Raw", "../../../etc/passwd"),
                // These read no file, so a stray filename is not checked.
                "biquad": {"type": "Biquad", "parameters": {"type": "Peaking", "filename": "/etc/passwd"}},
                "values": conv("Values", "/etc/passwd"),
                "dummy": conv("Dummy", "/etc/passwd"),
            },
        });
        assert_eq!(
            paths_outside_folders(&config, &coeffs, Some(&audio), &configs),
            [outside(
                &["filters", "escaping", "parameters", "filename"],
                "../../../etc/passwd"
            )]
        );
    }

    #[test]
    fn audio_paths_outside_the_folder_are_found() {
        let (_dir, configs, coeffs, audio) = folders();
        let check = |side: &str, device: Value| {
            let config = json!({"devices": {side: device}});
            paths_outside_folders(&config, &coeffs, Some(&audio), &configs)
        };
        for (side, device) in [
            ("capture", json!({"type": "WavFile", "filename": "in.wav"})),
            (
                "capture",
                json!({"type": "WavFile", "filename": "sub/in.wav"}),
            ),
            ("playback", json!({"type": "File", "filename": "out.wav"})),
        ] {
            assert_eq!(check(side, device), []);
        }
        for (side, device) in [
            (
                "capture",
                json!({"type": "WavFile", "filename": "/etc/passwd"}),
            ),
            (
                "capture",
                json!({"type": "RawFile", "filename": "/etc/shadow"}),
            ),
            (
                "playback",
                json!({"type": "File", "filename": "/tmp/out.wav"}),
            ),
        ] {
            let filename = device["filename"].as_str().unwrap().to_string();
            assert_eq!(
                check(side, device),
                [outside(&["devices", side, "filename"], &filename)]
            );
        }
    }

    #[test]
    fn offenders_come_in_config_order() {
        let (_dir, configs, coeffs, audio) = folders();
        let config = json!({
            "devices": {
                "playback": {"type": "File", "filename": "/tmp/out.wav"},
                "capture": {"type": "WavFile", "filename": "/tmp/in.wav"},
            },
            "filters": {"fir": conv("Raw", "/etc/passwd")},
        });
        assert_eq!(
            paths_outside_folders(&config, &coeffs, Some(&audio), &configs),
            [
                outside(&["filters", "fir", "parameters", "filename"], "/etc/passwd"),
                outside(&["devices", "capture", "filename"], "/tmp/in.wav"),
                outside(&["devices", "playback", "filename"], "/tmp/out.wav"),
            ]
        );
    }

    #[test]
    fn configs_without_files_have_no_offenders() {
        let (_dir, configs, coeffs, audio) = folders();
        for config in [
            json!({}),
            json!({"devices": {
                "capture": {"type": "Alsa", "channels": 2, "device": "hw:0"},
                "playback": {"type": "File", "filename": "out.wav"},
            }}),
        ] {
            assert_eq!(
                paths_outside_folders(&config, &coeffs, Some(&audio), &configs),
                []
            );
        }
    }

    #[test]
    fn only_coeff_file_paths_are_converted() {
        let config_dir = Path::new("/c/configs");
        let coeff_dir = Path::new("/c/coeffs");
        let no_filters = json!({"devices": {"samplerate": 48000}});
        // The stray filenames would change if these were read as files, the
        // bare one going absolute and the absolute one coming back bare. An
        // empty filename would become coeff_dir itself.
        let other_filters = json!({"filters": {
            "biquad": {"type": "Biquad", "parameters": {"type": "Peaking", "freq": 1000.0, "q": 1.0, "gain": 3.0, "filename": "f.raw"}},
            "values": {"type": "Conv", "parameters": {"type": "Values", "values": [1.0, 0.5], "filename": "/c/coeffs/f.raw"}},
            "empty": conv("Raw", ""),
        }});
        for original in [no_filters, other_filters] {
            let mut config = original.clone();
            make_config_filter_paths_absolute(&mut config, config_dir, coeff_dir);
            assert_eq!(config, original);
            make_config_filter_paths_relative(&mut config, config_dir, coeff_dir);
            assert_eq!(config, original);
        }
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

    #[cfg(windows)]
    #[test]
    fn windows_coeff_paths_round_trip() {
        let config_dir = Path::new(r"C:\cdsp\configs");
        let coeff_dir = Path::new(r"C:\cdsp\coeffs");
        for (relative, absolute) in [
            ("f.raw", r"C:\cdsp\coeffs\f.raw"),
            (r"..\coeffs\sub\f.raw", r"C:\cdsp\coeffs\sub\f.raw"),
            (r"..\other\f.raw", r"C:\cdsp\other\f.raw"),
            // Other drives and network shares have no relative form.
            (r"D:\cdsp\coeffs\f.raw", r"D:\cdsp\coeffs\f.raw"),
            (r"\\server\share\f.raw", r"\\server\share\f.raw"),
        ] {
            assert_eq!(
                coeff_path_to_absolute(relative, config_dir, coeff_dir),
                absolute
            );
            assert_eq!(
                coeff_path_to_relative(absolute, config_dir, coeff_dir),
                relative
            );
        }
        for path in [
            r"C:/cdsp/coeffs/f.raw",
            r"c:\CDSP\Coeffs\f.raw",
            r"\\?\C:\cdsp\coeffs\f.raw",
            r"C:\cdsp\coeffs\sub\..\f.raw",
        ] {
            assert_eq!(
                coeff_path_to_relative(path, config_dir, coeff_dir),
                "f.raw",
                "{path}"
            );
        }
        assert_eq!(
            coeff_path_to_relative(r"\\?\C:\cdsp\coeffs\sub\f.raw", config_dir, coeff_dir),
            r"..\coeffs\sub\f.raw"
        );
        assert_eq!(
            coeff_path_to_absolute("../coeffs/sub/f.raw", config_dir, coeff_dir),
            r"C:\cdsp\coeffs\sub\f.raw"
        );
        // A root without a drive is on config_dir's drive.
        assert_eq!(
            coeff_path_to_absolute(r"\cdsp\other\f.raw", config_dir, coeff_dir),
            r"C:\cdsp\other\f.raw"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_are_safe_where_they_land() {
        let (_dir, configs, coeffs, _audio) = folders();
        std::fs::create_dir_all(coeffs.join("sub")).unwrap();
        std::fs::write(coeffs.join("f.raw"), "x").unwrap();
        let written = to_string(&coeffs);
        let real = to_string(&std::fs::canonicalize(&coeffs).unwrap());
        assert!(real.starts_with(r"\\?\"), "{real}");
        let drive = &written[..2];
        let safe = |path: &str| path_is_safe(path, Some(&coeffs), Some(&configs));
        for path in [
            format!(r"{written}\f.raw"),
            format!("{}/f.raw", written.replace('\\', "/")),
            format!(r"{}\F.RAW", written.to_uppercase()),
            format!(r"{}\new.raw", written.to_lowercase()),
            format!(r"{real}\f.raw"),
            format!(r"{real}\new.raw"),
            // The long name of a folder the temp folder may give a short name.
            format!(r"{}\new.raw", &real[4..]),
            r"..\coeffs\sub\f.raw".to_string(),
            "../coeffs/sub/f.raw".to_string(),
        ] {
            assert!(safe(&path), "{path}");
        }
        for path in [
            r"..\..\..\Windows\win.ini".to_string(),
            format!(r"{drive}\Windows\win.ini"),
            r"\Windows\win.ini".to_string(),
            "/Windows/win.ini".to_string(),
            format!(r"{written}-elsewhere\f.raw"),
            format!(r"{written}\..\f.raw"),
            format!("{drive}f.raw"),
            "D:f.raw".to_string(),
            r"\\localhost\share\f.raw".to_string(),
            format!(r"\\?\{drive}\Windows\win.ini"),
            r"\\?\UNC\localhost\share\f.raw".to_string(),
        ] {
            assert!(!safe(&path), "{path}");
        }
        for folder in [&real, &written.to_uppercase(), &written.replace('\\', "/")] {
            let inside = format!(r"{written}\f.raw");
            assert!(
                path_is_safe(&inside, Some(Path::new(folder)), None),
                "{folder}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_audio_paths_round_trip() {
        let (_dir, _configs, _coeffs, audio) = folders();
        std::fs::create_dir_all(audio.join("sub")).unwrap();
        std::fs::write(audio.join(r"sub\in.wav"), "x").unwrap();
        let real = to_string(&std::fs::canonicalize(&audio).unwrap());
        let shouting = to_string(&audio).to_uppercase().replace('\\', "/");
        let mut config = json!({
            "devices": {
                "capture": {"type": "WavFile", "filename": format!(r"{real}\sub\in.wav")},
                "playback": {"type": "File", "filename": format!("{shouting}/out.wav")},
            },
        });
        make_audio_file_paths_relative(&mut config, Some(&audio));
        assert_eq!(config["devices"]["capture"]["filename"], r"sub\in.wav");
        assert_eq!(config["devices"]["playback"]["filename"], "out.wav");
        make_audio_file_paths_absolute(&mut config, Some(&audio));
        assert_eq!(
            config["devices"]["capture"]["filename"],
            under(&audio, "sub/in.wav")
        );
        assert_eq!(
            config["devices"]["playback"]["filename"],
            under(&audio, "out.wav")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_outside_the_folders_are_found() {
        let (_dir, configs, coeffs, audio) = folders();
        let config = json!({
            "filters": {
                "inside": conv("Raw", &format!(r"{}\f.raw", to_string(&coeffs).to_uppercase())),
                "relative": conv("Raw", r"..\coeffs\f.raw"),
                "other_drive": conv("Raw", r"D:\coeffs\f.raw"),
                "drive_relative": conv("Raw", "C:f.raw"),
                "rooted": conv("Raw", r"\Windows\win.ini"),
                "share": conv("Wav", r"\\localhost\share\f.wav"),
            },
            "devices": {
                "capture": {"type": "WavFile", "filename": r"..\in.wav"},
                "playback": {"type": "File", "filename": r"sub\out.wav"},
            },
        });
        let offenders = paths_outside_folders(&config, &coeffs, Some(&audio), &configs);
        let mut filenames: Vec<&str> = offenders.iter().map(|o| o.filename.as_str()).collect();
        filenames.sort();
        assert_eq!(
            filenames,
            [
                r"..\in.wav",
                "C:f.raw",
                r"D:\coeffs\f.raw",
                r"\Windows\win.ini",
                r"\\localhost\share\f.wav",
            ]
        );
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
