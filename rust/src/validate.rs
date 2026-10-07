//! Config validation, with camilladsp's own code.

use camilladsp_config::config::{self, Configuration, Issue, IssueKind, PathElement};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

/// Which device types a config may use.
///
/// The GUI's own build does not decide this, the connected CamillaDSP does.
/// Its list is used once it is known, narrowed further by the lists in the
/// backend settings if those are set. Before CamillaDSP has been reached and
/// with no lists in the settings, it falls back to what this build supports.
#[derive(Clone, Debug, Default)]
pub struct DeviceTypes {
    /// From `GetSupportedDeviceTypes`.
    pub dsp: Option<DeviceTypeLists>,
    /// `supported_capture_types` and `supported_playback_types` from the settings.
    pub settings_capture: Option<Vec<String>>,
    pub settings_playback: Option<Vec<String>>,
}

/// The device types a CamillaDSP build supports.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct DeviceTypeLists {
    pub playback: Vec<String>,
    pub capture: Vec<String>,
}

#[derive(Clone, Copy)]
enum Side {
    Capture,
    Playback,
}

impl Side {
    fn name(self) -> &'static str {
        match self {
            Side::Capture => "capture",
            Side::Playback => "playback",
        }
    }
}

impl DeviceTypes {
    /// `None` if the type is allowed, otherwise why not.
    fn refusal(&self, side: Side, type_name: &str, build_supported: bool) -> Option<String> {
        let (dsp, settings) = match side {
            Side::Capture => (
                self.dsp.as_ref().map(|d| &d.capture),
                self.settings_capture.as_ref(),
            ),
            Side::Playback => (
                self.dsp.as_ref().map(|d| &d.playback),
                self.settings_playback.as_ref(),
            ),
        };
        let side = side.name();
        if let Some(dsp) = dsp
            && !dsp.iter().any(|t| t == type_name)
        {
            return Some(format!(
                "The {type_name} {side} device type is not supported by the connected CamillaDSP"
            ));
        }
        if let Some(settings) = settings
            && !settings.iter().any(|t| t == type_name)
        {
            return Some(format!(
                "The {type_name} {side} device type is not in supported_{side}_types in the backend settings"
            ));
        }
        if dsp.is_none() && settings.is_none() && !build_supported {
            return Some(format!(
                "The {type_name} {side} device type is not supported on this platform"
            ));
        }
        None
    }

    /// Replace the build's verdict on the device types with this one.
    fn apply(&self, conf: &Configuration, issues: &mut Vec<Issue>) {
        let sides = [
            (
                Side::Capture,
                conf.devices.capture.type_name(),
                conf.devices.capture.is_supported(),
            ),
            (
                Side::Playback,
                conf.devices.playback.type_name(),
                conf.devices.playback.is_supported(),
            ),
        ];
        for (side, type_name, build_supported) in sides {
            let path = vec![
                PathElement::from("devices"),
                PathElement::from(side.name()),
                PathElement::from("type"),
            ];
            issues.retain(|issue| !(issue.kind == IssueKind::Unsupported && issue.path == path));
            if let Some(message) = self.refusal(side, type_name, build_supported) {
                issues.push(Issue::unsupported(path, message));
            }
        }
    }
}

/// How much an issue matters to the GUI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// CamillaDSP would refuse the config.
    Error,
    /// The config can be edited and saved as it is, but needs attention.
    Warning,
}

/// A problem with a config.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ValidationIssue {
    /// Where in the config, as keys and list indices from the top. Empty for
    /// the config as a whole.
    pub path: Vec<PathElement>,
    pub message: String,
    pub severity: Severity,
}

impl ValidationIssue {
    /// An error about the config as a whole.
    pub fn error(message: impl Into<String>) -> Self {
        ValidationIssue {
            path: Vec::new(),
            message: message.into(),
            severity: Severity::Error,
        }
    }
}

impl From<Issue> for ValidationIssue {
    fn from(issue: Issue) -> Self {
        let severity = match issue.kind {
            // A config can be edited before its coefficient files are uploaded,
            // so the GUI only warns about a missing file. CamillaDSP refuses it.
            IssueKind::MissingFile => Severity::Warning,
            IssueKind::Invalid | IssueKind::Unsupported => Severity::Error,
        };
        ValidationIssue {
            path: issue.path,
            message: issue.message,
            severity,
        }
    }
}

/// An issue as one line of text, with its path in front.
pub fn describe(issue: &Issue) -> String {
    if issue.path.is_empty() {
        issue.message.clone()
    } else {
        format!("{}: {}", config::format_path(&issue.path), issue.message)
    }
}

/// Parse a config, with every optional field filled in as CamillaDSP reads
/// it, or say where it went wrong.
pub fn parse(config: Value) -> Result<Configuration, String> {
    config::deserialize_config(config).map_err(|issue| describe(&issue))
}

/// Validate a config whose file paths are already absolute. Returns every
/// issue, an empty list if there are none.
///
/// Unlike CamillaDSP, this also checks the filters, mixers and processors
/// that the pipeline does not use, since a config editor wants to hear about
/// those too.
pub fn validate(config: Value, device_types: &DeviceTypes) -> Vec<ValidationIssue> {
    let mut conf = match config::deserialize_config(config) {
        Ok(conf) => conf,
        Err(issue) => return vec![issue.into()],
    };
    let mut issues = match config::validate_config(&mut conf, None) {
        Ok(_impulses) => Vec::new(),
        Err(issues) => issues.into_vec(),
    };
    if let Err(unused) = config::validate_unused(&conf) {
        issues.extend(unused.into_vec());
    }
    device_types.apply(&conf, &mut issues);
    issues.into_iter().map(ValidationIssue::from).collect()
}

/// Whether any of the issues stops the config from running.
pub fn has_errors(issues: &[ValidationIssue]) -> bool {
    issues.iter().any(|issue| issue.severity == Severity::Error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn devices(capture_type: &str) -> Value {
        let capture = if capture_type == "Wasapi" {
            json!({"type": capture_type, "channels": 2, "format": "S16", "device": "x"})
        } else {
            json!({"type": capture_type, "channels": 2, "format": "S16_LE"})
        };
        json!({
            "samplerate": 44100,
            "chunksize": 1024,
            "capture": capture,
            "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
        })
    }

    #[test]
    fn issues_have_paths_and_severity() {
        let mut config = json!({
            "devices": devices("Stdin"),
            "filters": {
                "lp": {"type": "Biquad", "parameters": {"type": "Lowpass", "freq": -5, "q": 0.7}},
                "fir": {"type": "Conv", "parameters": {"type": "Wav", "filename": "nope.wav"}},
                "unused": {"type": "Biquad", "parameters": {"type": "Highpass", "freq": -1, "q": 0.7}},
            },
            "pipeline": [
                {"type": "Filter", "channels": [0], "names": ["lp", "fir"]},
                {"type": "Filter", "channels": [5], "names": ["lp"]},
            ],
        });
        crate::paths::make_config_filter_paths_absolute(
            &mut config,
            Path::new("/tmp"),
            Path::new("/tmp"),
        );
        let issues = validate(config, &DeviceTypes::default());
        let has = |path: Value, severity: Severity| {
            issues
                .iter()
                .any(|issue| json!(issue.path) == path && issue.severity == severity)
        };
        assert!(
            has(
                json!(["filters", "lp", "parameters", "freq"]),
                Severity::Error
            ),
            "{issues:#?}"
        );
        assert!(
            has(
                json!(["filters", "fir", "parameters", "filename"]),
                Severity::Warning
            ),
            "{issues:#?}"
        );
        assert!(
            has(
                json!(["filters", "unused", "parameters", "freq"]),
                Severity::Error
            ),
            "{issues:#?}"
        );
        assert!(has_errors(&issues));
    }

    #[test]
    fn connected_dsp_decides_the_device_types() {
        let config = json!({"devices": devices("Wasapi")});
        let lists = |capture: &[&str]| DeviceTypes {
            dsp: Some(DeviceTypeLists {
                playback: vec!["Stdout".into()],
                capture: capture.iter().map(|s| s.to_string()).collect(),
            }),
            ..Default::default()
        };
        let type_issue = |issues: &[ValidationIssue]| {
            issues
                .iter()
                .any(|issue| json!(issue.path) == json!(["devices", "capture", "type"]))
        };
        // Wasapi only parses at all where camilladsp-config says it exists, so
        // a Linux or macOS build reports it as unsupported, unless the DSP has it.
        let issues = validate(config.clone(), &lists(&["Wasapi", "Stdin"]));
        assert!(!type_issue(&issues), "{issues:#?}");
        let issues = validate(config.clone(), &lists(&["Stdin"]));
        assert!(type_issue(&issues), "{issues:#?}");
        let config = json!({"devices": devices("Stdin")});
        let issues = validate(config, &lists(&["Alsa"]));
        assert!(type_issue(&issues), "{issues:#?}");
    }

    #[test]
    fn settings_narrow_the_device_types() {
        let config = json!({"devices": devices("Stdin")});
        let types = DeviceTypes {
            settings_capture: Some(vec!["Alsa".into()]),
            ..Default::default()
        };
        let issues = validate(config.clone(), &types);
        assert_eq!(issues.len(), 1, "{issues:#?}");
        assert!(validate(config, &DeviceTypes::default()).is_empty());
    }

    #[test]
    fn parsing_fills_in_defaults_or_says_where_it_failed() {
        let config = json!({"devices": devices("Stdin")});
        let parsed = crate::camilla::to_json(&parse(config).unwrap());
        assert!(
            parsed["devices"]
                .as_object()
                .unwrap()
                .contains_key("queuelimit")
        );
        let broken = json!({"devices": {"samplerate": "fast"}});
        let message = parse(broken).unwrap_err();
        assert!(message.starts_with("devices"), "{message}");
    }
}
