//! The backend's own settings, read from `camillagui.yml`.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The subset of `camillagui.yml` that the spike uses. Unknown keys are ignored,
/// so the same file works for the Python backend and this one.
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
    pub config_dir: PathBuf,
    pub coeff_dir: PathBuf,
    #[serde(default = "default_true")]
    pub enable_level_stream: bool,
    #[serde(default = "default_level_smoothing_ms")]
    pub level_smoothing_ms: f64,
    #[serde(default = "default_level_max_update_hz")]
    pub level_max_update_hz: f64,
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
    100.0
}
fn default_level_max_update_hz() -> f64 {
    30.0
}

impl Settings {
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
        let mut settings: Settings = yaml_serde::from_str(&text)
            .map_err(|err| format!("Invalid settings in {}: {err}", path.display()))?;
        settings.config_dir = absolute(&expand_home(&settings.config_dir));
        settings.coeff_dir = absolute(&expand_home(&settings.coeff_dir));
        Ok(settings)
    }
}

fn expand_home(path: &Path) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    match (path.strip_prefix("~"), home) {
        (Ok(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => path.to_path_buf(),
    }
}

fn absolute(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}
