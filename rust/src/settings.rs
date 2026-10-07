//! The backend's own settings, read from `camillagui.yml`, and the GUI
//! settings from `gui-config.yml`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
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
            settings.gui_config_file = Some(settings.settings_folder.join("gui-config.yml"));
        }
        settings.can_update_active_config = settings.find_can_update_active_config();
        log::debug!("Backend configuration: {settings:#?}");
        // Read the GUI config once, only to report any problems in it at startup.
        gui_config(&settings);
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

/// Whether a file can be written, or created if it does not exist yet.
fn is_file_writable(path: &Path) -> bool {
    if path.is_file() {
        return std::fs::OpenOptions::new().append(true).open(path).is_ok();
    }
    match path.parent() {
        Some(parent) if parent.is_dir() => std::fs::metadata(parent)
            .map(|meta| !meta.permissions().readonly())
            .unwrap_or(false),
        _ => false,
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
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct GuiConfig {
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
    pub custom_shortcuts: Vec<ShortcutSection>,
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

/// The defaults for what `gui-config.yml` leaves out.
fn gui_config_defaults() -> Map<String, Value> {
    let defaults = json!({
        "page_title": "CamillaDSP",
        "hide_capture_samplerate": false,
        "hide_silence": false,
        "hide_capture_device": false,
        "hide_playback_device": false,
        "hide_rate_monitoring": false,
        "hide_multithreading": false,
        "apply_config_automatically": false,
        "save_config_automatically": false,
        "status_update_interval": 500,
        "volume_range": 50,
        "volume_max": 0,
        "spectrum_min_freq": 20,
        "spectrum_max_freq": 20000,
        "spectrum_n_bins": 100,
        "spectrum_min_db": -100,
        "spectrum_max_db": 0,
        "spectrum_max_rate": 30,
        "custom_shortcuts": [],
    });
    match defaults {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

/// The settings the frontend gets from `camillagui.yml`.
fn backend_values(settings: &Settings) -> Map<String, Value> {
    let coeff_dir = crate::paths::relpath(&settings.coeff_dir, &settings.config_dir).join("");
    let values = json!({
        "coeff_dir": crate::paths::to_string(&coeff_dir),
        "supported_capture_types": settings.supported_capture_types,
        "supported_playback_types": settings.supported_playback_types,
        "can_update_active_config": settings.can_update_active_config,
        "audiofiles_supported": settings.audiofiles_dir.is_some(),
        "allow_absolute_paths": settings.allow_absolute_paths,
    });
    match values {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

/// The GUI settings, with defaults for what `gui-config.yml` leaves out. The
/// defaults alone if the file cannot be read or has problems.
pub fn gui_config(settings: &Settings) -> GuiConfig {
    gui_config_from(
        settings.gui_config_file.as_deref(),
        backend_values(settings),
    )
}

fn gui_config_from(path: Option<&Path>, backend: Map<String, Value>) -> GuiConfig {
    if let Some(path) = path {
        match read_gui_config(path, backend.clone()) {
            Ok(config) => return config,
            Err(err) => {
                log::error!("{err}");
                log::warn!("Unable to read gui config file, using defaults");
            }
        }
    }
    let mut config = gui_config_defaults();
    config.extend(backend);
    serde_json::from_value(Value::Object(config)).expect("the defaults are a valid GUI config")
}

fn read_gui_config(path: &Path, backend: Map<String, Value>) -> Result<GuiConfig, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("Config file could not be opened: {}, {err}", path.display()))?;
    let value: Value = yaml_serde::from_str(&text).map_err(|err| {
        format!(
            "Invalid yaml syntax in config file: {}, {err}",
            path.display()
        )
    })?;
    let error = |problem: String| format!("Error in config file '{}': {problem}", path.display());
    let Value::Object(mut config) = value else {
        return Err(error("not a mapping".to_string()));
    };
    for (key, value) in gui_config_defaults() {
        let entry = config.entry(key).or_insert(Value::Null);
        if entry.is_null() {
            *entry = value;
        }
    }
    // These come from camillagui.yml, whatever the file says.
    config.extend(backend);
    let config: GuiConfig =
        serde_path_to_error::deserialize(Value::Object(config)).map_err(|err| {
            let path = err.path().to_string();
            error(format!("Parameter '{path}': {}", err.into_inner()))
        })?;
    let problems = gui_config_problems(&config);
    if !problems.is_empty() {
        return Err(error(problems.join(", ")));
    }
    Ok(config)
}

/// The checks of the Python backend's GUI config schema that the types do
/// not make.
fn gui_config_problems(config: &GuiConfig) -> Vec<String> {
    let mut problems = Vec::new();
    let mut bad = |key: &str, what: &str| problems.push(format!("Parameter '{key}': {what}"));
    if config.page_title.is_empty() {
        bad("page_title", "must be a non-empty string");
    }
    if config.volume_range <= 0.0 {
        bad("volume_range", "must be a number larger than 0");
    }
    let unranged_number = config
        .custom_shortcuts
        .iter()
        .flat_map(|section| &section.shortcuts)
        .any(|shortcut| {
            shortcut.kind == Some(ShortcutType::Number)
                && (shortcut.range_from.is_none()
                    || shortcut.range_to.is_none()
                    || shortcut.step.is_none())
        });
    if unranged_number {
        bad(
            "custom_shortcuts",
            "a number shortcut needs 'range_from', 'range_to' and 'step'",
        );
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> Map<String, Value> {
        match json!({
            "coeff_dir": "../coeffs/",
            "supported_capture_types": null,
            "supported_playback_types": ["Alsa"],
            "can_update_active_config": true,
            "audiofiles_supported": false,
            "allow_absolute_paths": false,
        }) {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }

    fn read(text: &str) -> (Result<GuiConfig, String>, GuiConfig) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gui.yml");
        std::fs::write(&path, text).unwrap();
        (
            read_gui_config(&path, backend()),
            gui_config_from(Some(&path), backend()),
        )
    }

    #[test]
    fn gui_config_gets_defaults() {
        let (_, config) = read("page_title: Mine\nvolume_range: 30\ncustom_shortcuts:\n");
        assert_eq!(config.page_title, "Mine");
        assert_eq!(config.volume_range, 30.0);
        assert_eq!(config.status_update_interval, 500);
        assert!(config.custom_shortcuts.is_empty());
        assert_eq!(config.coeff_dir, "../coeffs/");
    }

    #[test]
    fn gui_config_cannot_override_the_backend_settings() {
        let (_, config) = read("allow_absolute_paths: true\ncoeff_dir: /\n");
        assert!(!config.allow_absolute_paths);
        assert_eq!(config.coeff_dir, "../coeffs/");
    }

    #[test]
    fn invalid_gui_config_gives_only_defaults() {
        let (result, config) = read("page_title: Mine\nhide_silence: maybe\n");
        assert!(
            result.unwrap_err().contains("Parameter 'hide_silence'"),
            "names the setting"
        );
        assert_eq!(config.page_title, "CamillaDSP");
        assert_eq!(
            config.supported_playback_types,
            Some(vec!["Alsa".to_string()])
        );
    }

    #[test]
    fn number_shortcut_needs_a_range() {
        let shortcut = "custom_shortcuts:\n  - section: S\n    shortcuts:\n      - name: x\n        \
                        config_elements: [{path: [a]}]\n        type: number\n";
        let (result, _) = read(shortcut);
        assert!(
            result
                .unwrap_err()
                .ends_with("a number shortcut needs 'range_from', 'range_to' and 'step'")
        );
        let (result, _) = read(&format!(
            "{shortcut}        range_from: 0\n        range_to: 1\n        step: 0.1\n"
        ));
        let config = result.unwrap();
        assert_eq!(
            config.custom_shortcuts[0].shortcuts[0].kind,
            Some(ShortcutType::Number)
        );
    }

    #[test]
    fn shipped_gui_config_is_valid() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../config/gui-config.yml");
        read_gui_config(&path, backend()).unwrap();
    }
}
