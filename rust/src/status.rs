//! `GET /api/status`, the counterpart of `get_status` in `backend/views.py`.

use crate::cdsp::{CdspClient, CdspError};
use serde_json::{Map, Value, json};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How often the slower changing values are refreshed.
const SLOW_REFRESH: Duration = Duration::from_secs(1);

const OFFLINE_STATUS: &str = "Offline";
const OFFLINE_VERSION: &str = "(offline)";

/// The status sent to the frontend, kept as a JSON object with the same keys as
/// the Python backend's `STATUSCACHE`.
pub struct StatusCache {
    values: Mutex<Map<String, Value>>,
    last_refresh: Mutex<Option<Instant>>,
}

impl StatusCache {
    pub fn new() -> Self {
        let mut values = Map::new();
        let initial = json!({
            "backend_version": env!("CARGO_PKG_VERSION"),
            // There is no pycamilladsp any more. Report the config crate the
            // validation comes from in its place, until the frontend drops the field.
            "py_cdsp_version": format!("camilladsp-config {}", camilladsp_config_version()),
            "capturesignalrms": [],
            "capturesignalpeak": [],
            "playbacksignalrms": [],
            "playbacksignalpeak": [],
            "backends": [],
            "playback_devices": {},
            "capture_devices": {},
            "playback_device_capabilities": {},
            "capture_device_capabilities": {},
            "labels": {"playback": null, "capture": null},
        });
        if let Value::Object(initial) = initial {
            values.extend(initial);
        }
        let cache = StatusCache {
            values: Mutex::new(values),
            last_refresh: Mutex::new(None),
        };
        cache.set_offline();
        cache
    }

    fn set_offline(&self) {
        let offline = json!({
            "cdsp_status": OFFLINE_STATUS,
            "cdsp_version": OFFLINE_VERSION,
            "capturerate": null,
            "rateadjust": null,
            "bufferlevel": null,
            "clippedsamples": null,
            "processingload": null,
            "resamplerload": null,
            "title": null,
            "description": null,
        });
        self.merge(offline);
        *self.last_refresh.lock().unwrap() = None;
    }

    fn merge(&self, update: Value) {
        if let Value::Object(update) = update {
            self.values.lock().unwrap().extend(update);
        }
    }

    pub fn update_levels(&self, levels: &Value) {
        self.merge(levels.clone());
    }

    fn snapshot(&self) -> Value {
        Value::Object(self.values.lock().unwrap().clone())
    }

    /// Ask CamillaDSP for its state, and once a second for everything else.
    pub async fn refresh(&self, cdsp: &CdspClient) -> Value {
        match self.query_all(cdsp).await {
            Ok(()) => {}
            Err(err) => {
                log::debug!("Status query failed: {err}");
                self.set_offline();
            }
        }
        self.snapshot()
    }

    async fn query_all(&self, cdsp: &CdspClient) -> Result<(), CdspError> {
        let state = cdsp.query("GetState").await?;
        // pycamilladsp turns the state into an enum, and the backend sent its
        // name, so the frontend gets "RUNNING" rather than "Running".
        let state = state.as_str().unwrap_or("").to_uppercase();
        self.merge(json!({"cdsp_status": state}));
        let due = match *self.last_refresh.lock().unwrap() {
            Some(last) => last.elapsed() > SLOW_REFRESH,
            None => true,
        };
        if !due {
            return Ok(());
        }
        *self.last_refresh.lock().unwrap() = Some(Instant::now());
        let update = json!({
            "cdsp_version": value(cdsp, "GetVersion").await?,
            "capturerate": value(cdsp, "GetCaptureRate").await?,
            "rateadjust": value(cdsp, "GetRateAdjust").await?,
            "bufferlevel": value(cdsp, "GetBufferLevel").await?,
            "clippedsamples": value(cdsp, "GetClippedSamples").await?,
            "processingload": value(cdsp, "GetProcessingLoad").await?,
            "resamplerload": value(cdsp, "GetResamplerLoad").await?,
            "labels": value(cdsp, "GetChannelLabels").await?,
            "title": value(cdsp, "GetConfigTitle").await?,
            "description": value(cdsp, "GetConfigDescription").await?,
        });
        self.merge(update);
        Ok(())
    }
}

/// A value that CamillaDSP declines to give, for example with no config
/// loaded, is shown as missing. Only a lost connection means offline.
async fn value(cdsp: &CdspClient, command: &str) -> Result<Value, CdspError> {
    match cdsp.query(command).await {
        Err(CdspError::Command(err)) => {
            log::debug!("{command} failed: {err}");
            Ok(Value::Null)
        }
        other => other,
    }
}

fn camilladsp_config_version() -> &'static str {
    // Cargo gives no direct way to read a dependency's version, and this is
    // only for display, so it is kept in step with Cargo.toml by hand.
    "5.0.0"
}
