//! Config validation, with camilladsp's own code.

use camilladsp_config::config::{self, Configuration, Issue, IssueKind, PathElement};
use serde_json::{Value, json};

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

#[derive(Clone, Debug)]
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

/// How the GUI treats each kind of issue.
fn severity(kind: IssueKind) -> &'static str {
    match kind {
        // A config can be edited before its coefficient files are uploaded, so
        // the GUI only warns about a missing file. CamillaDSP itself refuses it.
        IssueKind::MissingFile => "warning",
        IssueKind::Invalid | IssueKind::Unsupported => "error",
    }
}

/// An issue as `[path, message, severity]`, the shape the frontend's `Errors` reads.
fn issue_to_json(issue: &Issue) -> Value {
    let path: Vec<Value> = issue
        .path
        .iter()
        .map(|element| match element {
            PathElement::Key(key) => json!(key),
            PathElement::Index(index) => json!(index),
        })
        .collect();
    json!([path, issue.message, severity(issue.kind)])
}

/// Validate a config whose file paths are already absolute. Returns every
/// issue, an empty list if there are none.
///
/// Unlike CamillaDSP, this also checks the filters, mixers and processors
/// that the pipeline does not use, since a config editor wants to hear about
/// those too.
pub fn validate(config: Value, device_types: &DeviceTypes) -> Vec<Value> {
    let mut conf = match config::deserialize_config(config) {
        Ok(conf) => conf,
        Err(issue) => return vec![issue_to_json(&issue)],
    };
    let mut issues = match config::validate_config(&mut conf, None) {
        Ok(_impulses) => Vec::new(),
        Err(issues) => issues.into_vec(),
    };
    if let Err(unused) = config::validate_unused(&conf) {
        issues.extend(unused.into_vec());
    }
    device_types.apply(&conf, &mut issues);
    issues.iter().map(issue_to_json).collect()
}

/// Whether any of the issues stops the config from running.
pub fn has_errors(issues: &[Value]) -> bool {
    issues.iter().any(|issue| issue[2] == "error")
}

/// The config as CamillaDSP reads it, with every optional field filled in,
/// like the Python backend's schema validation did. A config that does not
/// deserialize is returned unchanged, so that it can still be edited.
pub fn with_defaults(config: Value) -> Value {
    match config::deserialize_config(&config) {
        Ok(conf) => serde_json::to_value(&conf).unwrap_or(config),
        Err(_) => config,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let has = |path: Value, severity: &str| {
            issues
                .iter()
                .any(|issue| issue[0] == path && issue[2] == severity)
        };
        assert!(
            has(json!(["filters", "lp", "parameters", "freq"]), "error"),
            "{issues:#?}"
        );
        assert!(
            has(
                json!(["filters", "fir", "parameters", "filename"]),
                "warning"
            ),
            "{issues:#?}"
        );
        assert!(
            has(json!(["filters", "unused", "parameters", "freq"]), "error"),
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
        let type_issue = |issues: &[Value]| {
            issues
                .iter()
                .any(|issue| issue[0] == json!(["devices", "capture", "type"]))
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
    fn defaults_are_filled_in() {
        let config = json!({"devices": devices("Stdin")});
        let filled = with_defaults(config);
        assert!(
            filled["devices"]
                .as_object()
                .unwrap()
                .contains_key("queuelimit")
        );
        let broken = json!({"devices": {"samplerate": "fast"}});
        assert_eq!(with_defaults(broken.clone()), broken);
    }
}
