//! The backend's own settings, read from `camillagui.yml`, and the GUI
//! settings from `gui-config.yml`.

use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

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
        gui_config_or_defaults(settings.gui_config_file.as_deref());
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

/// The defaults for the optional GUI settings.
fn gui_config_defaults() -> Map<String, Value> {
    let defaults = json!({
        "page_title": "CamillaDSP",
        "hide_capture_samplerate": false,
        "hide_silence": false,
        "hide_capture_device": false,
        "hide_playback_device": false,
        "hide_multithreading": false,
        "apply_config_automatically": false,
        "save_config_automatically": false,
        "status_update_interval": 500,
        "volume_range": 50,
        "volume_max": 0,
    });
    match defaults {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

/// The GUI settings from file, with defaults for what it leaves out. The
/// defaults alone if the file cannot be read or has problems.
pub fn gui_config_or_defaults(path: Option<&Path>) -> Map<String, Value> {
    let Some(path) = path else {
        return gui_config_defaults();
    };
    match read_gui_config(path) {
        Ok(mut config) => {
            for (key, value) in gui_config_defaults() {
                config.entry(key).or_insert(value);
            }
            config
        }
        Err(err) => {
            log::error!("{err}");
            log::warn!("Unable to read gui config file, using defaults");
            gui_config_defaults()
        }
    }
}

fn read_gui_config(path: &Path) -> Result<Map<String, Value>, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("Config file could not be opened: {}, {err}", path.display()))?;
    let value: Value = yaml_serde::from_str(&text).map_err(|err| {
        format!(
            "Invalid yaml syntax in config file: {}, {err}",
            path.display()
        )
    })?;
    let Value::Object(config) = value else {
        return Err(format!(
            "Error in config file '{}': not a mapping",
            path.display()
        ));
    };
    let problems = gui_config_problems(&config);
    if !problems.is_empty() {
        return Err(format!(
            "Error in config file '{}': {}",
            path.display(),
            problems.join(", ")
        ));
    }
    Ok(config)
}

/// The checks of the Python backend's GUI config schema.
fn gui_config_problems(config: &Map<String, Value>) -> Vec<String> {
    let mut problems = Vec::new();
    let mut bad = |key: &str, what: &str| problems.push(format!("Parameter '{key}': {what}"));
    for (key, value) in config {
        match key.as_str() {
            "page_title" => {
                if !value.as_str().is_some_and(|s| !s.is_empty()) {
                    bad(key, "must be a non-empty string");
                }
            }
            "hide_capture_samplerate"
            | "hide_silence"
            | "hide_capture_device"
            | "hide_playback_device"
            | "hide_multithreading"
            | "apply_config_automatically"
            | "save_config_automatically" => {
                if !value.is_boolean() {
                    bad(key, "must be true or false");
                }
            }
            "status_update_interval" | "volume_max" => {
                if !(value.is_i64() || value.is_u64()) {
                    bad(key, "must be an integer");
                }
            }
            "volume_range" => {
                if !value.as_f64().is_some_and(|v| v > 0.0) {
                    bad(key, "must be a number larger than 0");
                }
            }
            "custom_shortcuts" => {
                if let Some(problem) = shortcuts_problem(value) {
                    bad(key, &problem);
                }
            }
            _ => {}
        }
    }
    problems
}

fn shortcuts_problem(value: &Value) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let Some(sections) = value.as_array() else {
        return Some("must be a list".to_string());
    };
    for section in sections {
        if !section.get("section").is_some_and(Value::is_string) {
            return Some("every section needs a 'section' name".to_string());
        }
        let Some(shortcuts) = section.get("shortcuts").and_then(Value::as_array) else {
            return Some("every section needs a list of 'shortcuts'".to_string());
        };
        for shortcut in shortcuts {
            if !shortcut.get("name").is_some_and(Value::is_string) {
                return Some("every shortcut needs a 'name'".to_string());
            }
            let Some(elements) = shortcut.get("config_elements").and_then(Value::as_array) else {
                return Some("every shortcut needs a list of 'config_elements'".to_string());
            };
            if elements
                .iter()
                .any(|element| !element.get("path").is_some_and(Value::is_array))
            {
                return Some("every config element needs a 'path'".to_string());
            }
            let kind = shortcut.get("type");
            if !matches!(
                kind.and_then(Value::as_str),
                None | Some("boolean" | "number")
            ) {
                return Some("a shortcut 'type' must be 'boolean' or 'number'".to_string());
            }
            if kind.and_then(Value::as_str) == Some("number")
                && ["range_from", "range_to", "step"]
                    .iter()
                    .any(|key| !shortcut.get(*key).is_some_and(Value::is_number))
            {
                return Some(
                    "a number shortcut needs 'range_from', 'range_to' and 'step'".to_string(),
                );
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_config_gets_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gui.yml");
        std::fs::write(&path, "page_title: Mine\nvolume_range: 30\n").unwrap();
        let config = gui_config_or_defaults(Some(&path));
        assert_eq!(config["page_title"], "Mine");
        assert_eq!(config["volume_range"], 30);
        assert_eq!(config["status_update_interval"], 500);
    }

    #[test]
    fn invalid_gui_config_gives_only_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gui.yml");
        std::fs::write(&path, "page_title: Mine\nhide_silence: maybe\n").unwrap();
        let config = gui_config_or_defaults(Some(&path));
        assert_eq!(config["page_title"], "CamillaDSP");
    }

    #[test]
    fn number_shortcut_needs_a_range() {
        let shortcuts = json!([{"section": "S", "shortcuts": [
            {"name": "x", "config_elements": [{"path": ["a"]}], "type": "number"}
        ]}]);
        assert!(shortcuts_problem(&shortcuts).is_some());
        let shortcuts = json!([{"section": "S", "shortcuts": [
            {"name": "x", "config_elements": [{"path": ["a"]}], "type": "number",
             "range_from": 0, "range_to": 1, "step": 0.1}
        ]}]);
        assert!(shortcuts_problem(&shortcuts).is_none());
    }
}
