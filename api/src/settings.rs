//! The backend's own settings, read from `camillagui.yml`, and the GUI
//! settings from `gui-config.yml`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use utoipa::ToSchema;

/// `camillagui.yml`. Unknown keys are ignored.
#[derive(Debug, Deserialize)]
pub struct Settings {
    #[serde(default = "default_camilla_host")]
    pub camilla_host: String,
    #[serde(default = "default_camilla_port")]
    pub camilla_port: u16,
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// HTTPS is left to a reverse proxy. These are only read so that the
    /// backend can refuse to start when they are set, see `main`.
    #[serde(default)]
    pub ssl_certificate: Option<PathBuf>,
    #[serde(default)]
    pub ssl_private_key: Option<PathBuf>,
    #[serde(default)]
    pub gui_config_file: Option<PathBuf>,
    pub config_dir: PathBuf,
    pub coeff_dir: PathBuf,
    #[serde(default)]
    pub audiofiles_dir: Option<PathBuf>,
    #[serde(default)]
    pub default_config: Option<PathBuf>,
    #[serde(default)]
    pub statefile_path: Option<PathBuf>,
    #[serde(default)]
    pub log_file: Option<String>,
    #[serde(default)]
    pub on_set_active_config: Option<String>,
    #[serde(default)]
    pub on_get_active_config: Option<String>,
    #[serde(default)]
    pub supported_capture_types: Option<Vec<String>>,
    #[serde(default)]
    pub supported_playback_types: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub enable_level_stream: bool,
    #[serde(default = "default_level_smoothing_ms")]
    pub level_smoothing_ms: f64,
    #[serde(default = "default_level_max_update_hz")]
    pub level_max_update_hz: f64,
    #[serde(default)]
    pub allow_absolute_paths: bool,
    /// Worked out after loading, from the statefile and the commands.
    #[serde(skip)]
    pub can_update_active_config: bool,
    /// The folder `camillagui.yml` is in, where the GUI config and the style
    /// override are looked for.
    #[serde(skip)]
    pub settings_folder: PathBuf,
}

fn default_camilla_host() -> String {
    "127.0.0.1".to_string()
}
fn default_camilla_port() -> u16 {
    1234
}
fn default_bind_address() -> String {
    "0.0.0.0".to_string()
}
fn default_port() -> u16 {
    5005
}
fn default_true() -> bool {
    true
}
fn default_level_smoothing_ms() -> f64 {
    200.0
}
fn default_level_max_update_hz() -> f64 {
    30.0
}

/// The folder the default config files are looked for in: `config/` next to
/// the executable, the same layout as the Python backend had next to its code.
pub fn default_config_folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_default()
        .join("config")
}

impl Settings {
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
        let mut settings: Settings = yaml_serde::from_str(&text)
            .map_err(|err| format!("Invalid settings in {}: {err}", path.display()))?;
        settings.check()?;
        settings.config_dir = absolute(&settings.config_dir);
        settings.coeff_dir = absolute(&settings.coeff_dir);
        for path in [
            &mut settings.audiofiles_dir,
            &mut settings.default_config,
            &mut settings.statefile_path,
            &mut settings.gui_config_file,
            &mut settings.ssl_certificate,
            &mut settings.ssl_private_key,
        ] {
            *path = path.as_deref().map(absolute);
        }
        settings.settings_folder = absolute(path.parent().unwrap_or(Path::new(".")));
        if settings.gui_config_file.is_none() {
            let default = settings.settings_folder.join("gui-config.yml");
            settings.gui_config_file = default.is_file().then_some(default);
        }
        // A GUI config with problems stops the backend here, rather than the
        // GUI quietly getting the defaults.
        if let Some(gui_config_file) = &settings.gui_config_file {
            GuiConfigFile::read(gui_config_file)?;
        }
        settings.can_update_active_config = settings.find_can_update_active_config();
        log::debug!("Backend configuration: {settings:#?}");
        Ok(settings)
    }

    /// The rules the Python backend's settings schema had beyond the types.
    fn check(&self) -> Result<(), String> {
        let mut empty = Vec::new();
        let strings = [
            ("camilla_host", Some(self.camilla_host.as_str())),
            ("bind_address", Some(self.bind_address.as_str())),
            ("config_dir", self.config_dir.to_str()),
            ("coeff_dir", self.coeff_dir.to_str()),
            ("log_file", self.log_file.as_deref()),
            ("on_set_active_config", self.on_set_active_config.as_deref()),
            ("on_get_active_config", self.on_get_active_config.as_deref()),
        ];
        for (name, value) in strings {
            if value == Some("") {
                empty.push(name);
            }
        }
        let paths = [
            ("ssl_certificate", &self.ssl_certificate),
            ("ssl_private_key", &self.ssl_private_key),
            ("gui_config_file", &self.gui_config_file),
            ("audiofiles_dir", &self.audiofiles_dir),
            ("default_config", &self.default_config),
            ("statefile_path", &self.statefile_path),
        ];
        for (name, value) in paths {
            if value.as_ref().is_some_and(|p| p.as_os_str().is_empty()) {
                empty.push(name);
            }
        }
        for (name, types) in [
            ("supported_capture_types", &self.supported_capture_types),
            ("supported_playback_types", &self.supported_playback_types),
        ] {
            if types.iter().flatten().any(String::is_empty) {
                empty.push(name);
            }
        }
        if empty.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "These settings must not be empty: {}",
                empty.join(", ")
            ))
        }
    }

    /// Whether the backend can persist the name of the active config file.
    fn find_can_update_active_config(&self) -> bool {
        let mut statefile_supported = false;
        if let Some(statefile) = &self.statefile_path {
            if is_file_writable(statefile) {
                statefile_supported = true;
            } else {
                log::error!("The statefile {} is not writable.", statefile.display());
            }
        }
        let external_supported =
            self.on_set_active_config.is_some() && self.on_get_active_config.is_some();
        statefile_supported || external_supported
    }
}

/// Whether a file can be written, or created if it does not exist yet. Tried
/// for real rather than read from the permission bits, which say nothing
/// about who owns the file or folder.
fn is_file_writable(path: &Path) -> bool {
    if path.is_file() {
        // Opening for appending writes nothing and truncates nothing.
        return std::fs::OpenOptions::new().append(true).open(path).is_ok();
    }
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return false;
    };
    if !parent.is_dir() {
        return false;
    }
    // A file of our own next to it, so that nothing ever sees an empty statefile.
    let mut probe_name = std::ffi::OsString::from(".");
    probe_name.push(name);
    probe_name.push(format!(".camillagui-{}", std::process::id()));
    let probe = parent.join(probe_name);
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(file) => {
            drop(file);
            if let Err(err) = std::fs::remove_file(&probe) {
                log::warn!("Could not remove {}: {err}", probe.display());
            }
            true
        }
        Err(_) => false,
    }
}

pub fn expand_home(path: &Path) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    match (path.strip_prefix("~"), home) {
        (Ok(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => path.to_path_buf(),
    }
}

/// Expand `~` and make absolute, like `os.path.abspath(os.path.expanduser(path))`.
pub fn absolute(path: &Path) -> PathBuf {
    let expanded = expand_home(path);
    let absolute = std::path::absolute(&expanded).unwrap_or(expanded);
    crate::paths::normalize(&absolute)
}

/// The GUI settings: `gui-config.yml`, and the few settings from
/// `camillagui.yml` that the frontend needs.
#[derive(Debug, Serialize, ToSchema)]
pub struct GuiConfig {
    #[serde(flatten)]
    pub file: GuiConfigFile,
    /// coeff_dir, relative to config_dir and ending with a separator, from
    /// `camillagui.yml` like the rest below.
    pub coeff_dir: String,
    #[schema(required)]
    pub supported_capture_types: Option<Vec<String>>,
    #[schema(required)]
    pub supported_playback_types: Option<Vec<String>>,
    /// Whether the backend can store which config file is the active one.
    pub can_update_active_config: bool,
    /// Whether an audiofiles_dir is set.
    pub audiofiles_supported: bool,
    pub allow_absolute_paths: bool,
}

/// `gui-config.yml`. What it leaves out gets the default, and keys it does
/// not know are ignored.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(default)]
pub struct GuiConfigFile {
    /// The title of the browser tab.
    pub page_title: String,
    pub hide_capture_samplerate: bool,
    pub hide_silence: bool,
    pub hide_capture_device: bool,
    pub hide_playback_device: bool,
    pub hide_rate_monitoring: bool,
    pub hide_multithreading: bool,
    pub apply_config_automatically: bool,
    pub save_config_automatically: bool,
    /// In milliseconds.
    pub status_update_interval: u32,
    /// The range of the volume sliders, in dB.
    pub volume_range: f64,
    /// The top of the volume sliders, in dB.
    pub volume_max: i32,
    /// In Hz.
    pub spectrum_min_freq: f64,
    /// In Hz.
    pub spectrum_max_freq: f64,
    pub spectrum_n_bins: usize,
    pub spectrum_min_db: f64,
    pub spectrum_max_db: f64,
    /// The most spectrum updates per second.
    pub spectrum_max_rate: f32,
    /// `custom_shortcuts:` with nothing after it is null, and means none.
    #[serde(deserialize_with = "null_as_empty")]
    pub custom_shortcuts: Vec<ShortcutSection>,
}

impl Default for GuiConfigFile {
    fn default() -> Self {
        GuiConfigFile {
            page_title: "CamillaDSP".to_string(),
            hide_capture_samplerate: false,
            hide_silence: false,
            hide_capture_device: false,
            hide_playback_device: false,
            hide_rate_monitoring: false,
            hide_multithreading: false,
            apply_config_automatically: false,
            save_config_automatically: false,
            status_update_interval: 500,
            volume_range: 50.0,
            volume_max: 0,
            spectrum_min_freq: 20.0,
            spectrum_max_freq: 20000.0,
            spectrum_n_bins: 100,
            spectrum_min_db: -100.0,
            spectrum_max_db: 0.0,
            spectrum_max_rate: 30.0,
            custom_shortcuts: Vec::new(),
        }
    }
}

fn null_as_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::deserialize(deserializer)?.unwrap_or_default())
}

// The shortcuts are sent as written, so what the file leaves out is left out.

/// A group of shortcuts, with a heading.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ShortcutSection {
    pub section: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub description: Option<String>,
    pub shortcuts: Vec<Shortcut>,
}

/// A control for one or more values in the config.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct Shortcut {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub description: Option<String>,
    /// The values it controls. The control shows the first one, the others
    /// follow it.
    pub config_elements: Vec<ConfigElement>,
    /// Needed for a number.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub range_from: Option<f64>,
    /// Needed for a number.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub range_to: Option<f64>,
    /// Needed for a number.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub step: Option<f64>,
    /// A slider when not given.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub kind: Option<ShortcutType>,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ShortcutType {
    /// A checkbox.
    Boolean,
    /// A slider.
    Number,
}

/// A value in the config that a shortcut controls.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ConfigElement {
    /// The keys leading to the value.
    pub path: Vec<String>,
    /// Move this one the opposite way of the control.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub reverse: Option<bool>,
}

impl GuiConfigFile {
    /// Read `gui-config.yml`, or say what is wrong with it.
    pub fn read(path: &Path) -> Result<Self, String> {
        let error = |problem: String| format!("Error in {}: {problem}", path.display());
        let text = std::fs::read_to_string(path).map_err(|err| error(err.to_string()))?;
        let file: GuiConfigFile =
            yaml_serde::from_str(&text).map_err(|err| error(err.to_string()))?;
        file.check().map_err(error)?;
        Ok(file)
    }

    /// What the types do not rule out.
    fn check(&self) -> Result<(), String> {
        if self.volume_range <= 0.0 {
            return Err("volume_range must be larger than 0".to_string());
        }
        let unranged_slider = self
            .custom_shortcuts
            .iter()
            .flat_map(|section| &section.shortcuts)
            .find(|shortcut| {
                shortcut.kind != Some(ShortcutType::Boolean)
                    && (shortcut.range_from.is_none()
                        || shortcut.range_to.is_none()
                        || shortcut.step.is_none())
            });
        if let Some(shortcut) = unranged_slider {
            return Err(format!(
                "the shortcut '{}' is a slider, and needs 'range_from', 'range_to' and 'step'",
                shortcut.name
            ));
        }
        Ok(())
    }
}

/// The GUI settings. The defaults stand in for a `gui-config.yml` that
/// stopped being readable after the backend started.
pub fn gui_config(settings: &Settings) -> GuiConfig {
    let file = match &settings.gui_config_file {
        Some(path) => GuiConfigFile::read(path).unwrap_or_else(|err| {
            log::error!("{err}. Using the default GUI settings.");
            GuiConfigFile::default()
        }),
        None => GuiConfigFile::default(),
    };
    let coeff_dir = crate::paths::relpath(&settings.coeff_dir, &settings.config_dir).join("");
    GuiConfig {
        file,
        coeff_dir: crate::paths::to_string(&coeff_dir),
        supported_capture_types: settings.supported_capture_types.clone(),
        supported_playback_types: settings.supported_playback_types.clone(),
        can_update_active_config: settings.can_update_active_config,
        audiofiles_supported: settings.audiofiles_dir.is_some(),
        allow_absolute_paths: settings.allow_absolute_paths,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Result<GuiConfigFile, String> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gui.yml");
        std::fs::write(&path, text).unwrap();
        GuiConfigFile::read(&path)
    }

    #[test]
    fn gui_config_gets_defaults() {
        let config = read("page_title: Mine\nvolume_range: 30\ncustom_shortcuts:\n").unwrap();
        assert_eq!(config.page_title, "Mine");
        assert_eq!(config.volume_range, 30.0);
        assert_eq!(config.status_update_interval, 500);
        assert!(config.custom_shortcuts.is_empty());
    }

    #[test]
    fn gui_config_problems_name_the_setting() {
        let err = read("page_title: Mine\nhide_silence: maybe\n").unwrap_err();
        assert!(err.contains("hide_silence"), "{err}");
        let err = read("volume_range: 0\n").unwrap_err();
        assert!(err.contains("volume_range"), "{err}");
    }

    #[test]
    fn slider_shortcut_needs_a_range() {
        let shortcut = "custom_shortcuts:\n  - section: S\n    shortcuts:\n      - name: x\n        \
                        config_elements: [{path: [a]}]\n";
        let range = "        range_from: 0\n        range_to: 1\n        step: 0.1\n";
        for kind in ["", "        type: number\n"] {
            let err = read(&format!("{shortcut}{kind}")).unwrap_err();
            assert!(
                err.ends_with(
                    "the shortcut 'x' is a slider, and needs 'range_from', 'range_to' and 'step'"
                ),
                "{err}"
            );
            let config = read(&format!("{shortcut}{kind}{range}")).unwrap();
            assert_eq!(config.custom_shortcuts[0].shortcuts[0].range_to, Some(1.0));
        }
        read(&format!("{shortcut}        type: boolean\n")).unwrap();
    }

    #[test]
    fn gui_config_with_problems_stops_startup() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("camillagui.yml");
        std::fs::write(&settings, "config_dir: configs\ncoeff_dir: coeffs\n").unwrap();
        let loaded = Settings::load(&settings).unwrap();
        assert_eq!(loaded.gui_config_file, None, "no gui-config.yml is fine");
        std::fs::write(dir.path().join("gui-config.yml"), "volume_range: -1\n").unwrap();
        let err = Settings::load(&settings).unwrap_err();
        assert!(err.contains("volume_range"), "{err}");
    }

    #[test]
    fn statefile_check_leaves_no_trace() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("state.yml");
        assert!(is_file_writable(&missing));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);

        let existing = dir.path().join("existing.yml");
        std::fs::write(&existing, "config_path: /a.yml\n").unwrap();
        assert!(is_file_writable(&existing));
        assert_eq!(
            std::fs::read_to_string(&existing).unwrap(),
            "config_path: /a.yml\n"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);

        assert!(!is_file_writable(&dir.path().join("nofolder/state.yml")));
    }

    /// The root folder is typically 0755 and owned by root, so its permission
    /// bits say writable while only root can create a file in it.
    #[cfg(unix)]
    #[test]
    fn statefile_in_a_folder_of_another_user_is_not_writable() {
        use std::os::unix::fs::MetadataExt;
        let dir = tempfile::tempdir().unwrap();
        let mine = dir.path().join("mine");
        std::fs::write(&mine, "").unwrap();
        let uid = std::fs::metadata(&mine).unwrap().uid();
        let root = std::fs::metadata("/").unwrap();
        if uid == 0 || root.uid() == uid {
            eprintln!("skipped: running as root, or the root folder is our own");
            return;
        }
        let statefile = Path::new("/camillagui-statefile-test.yml");
        assert!(!statefile.exists());
        assert!(!is_file_writable(statefile));
    }

    #[test]
    fn shipped_gui_config_is_valid() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../config/gui-config.yml");
        GuiConfigFile::read(&path).unwrap();
    }
}
