//! The status sent to the frontend by `GET /api/status`, kept as a JSON
//! object with the same keys as the Python backend's `STATUSCACHE`.

use crate::camilla::{CamillaClient, DspError, to_json};
use crate::validate::DeviceTypeLists;
use serde_json::{Map, Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How often the slower changing values are refreshed.
const SLOW_REFRESH: Duration = Duration::from_secs(1);

/// The common sample rates a measured capture rate is rounded to.
const STANDARD_RATES: [usize; 15] = [
    8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000,
    705600, 768000,
];

/// The nearest standard rate, if the measured one is within 4% of it.
fn nearest_standard_rate(rate: usize) -> Option<usize> {
    let rate_f = rate as f64;
    let lowest = STANDARD_RATES[0] as f64;
    let highest = STANDARD_RATES[STANDARD_RATES.len() - 1] as f64;
    if !(0.96 * lowest < rate_f && rate_f < 1.04 * highest) {
        return None;
    }
    let nearest = *STANDARD_RATES
        .iter()
        .min_by_key(|standard| standard.abs_diff(rate))?;
    let ratio = rate_f / nearest as f64;
    (0.96 < ratio && ratio < 1.04).then_some(nearest)
}

pub struct StatusCache {
    values: Mutex<Map<String, Value>>,
    last_refresh: Mutex<Option<Instant>>,
    /// The client connection the version and device lists were read on, 0
    /// for none. When the client has made a new one, they are read again.
    connection: AtomicU64,
    /// The device types the connected CamillaDSP supports, once known.
    device_types: Mutex<Option<DeviceTypeLists>>,
}

impl StatusCache {
    pub fn new() -> Self {
        let initial = json!({
            "backend_version": env!("CARGO_PKG_VERSION"),
            "backends": [],
            "playback_devices": {},
            "capture_devices": {},
            "playback_device_capabilities": {},
            "capture_device_capabilities": {},
            "labels": {"playback": null, "capture": null},
        });
        let cache = StatusCache {
            values: Mutex::new(Map::new()),
            last_refresh: Mutex::new(None),
            connection: AtomicU64::new(0),
            device_types: Mutex::new(None),
        };
        cache.merge(initial);
        cache.set_offline();
        cache
    }

    fn set_offline(&self) {
        self.merge(json!({
            "cdsp_online": false,
            "cdsp_version": "(offline)",
            "capturerate": null,
            "rateadjust": null,
            "bufferlevel": null,
            "clippedsamples": null,
            "processingload": null,
            "resamplerload": null,
            "title": null,
            "description": null,
        }));
        *self.last_refresh.lock().unwrap() = None;
        self.connection.store(0, Ordering::Relaxed);
    }

    pub fn merge(&self, update: Value) {
        if let Value::Object(update) = update {
            self.values.lock().unwrap().extend(update);
        }
    }

    pub fn get(&self, key: &str) -> Value {
        self.values
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn snapshot(&self) -> Value {
        Value::Object(self.values.lock().unwrap().clone())
    }

    pub fn device_types(&self) -> Option<DeviceTypeLists> {
        self.device_types.lock().unwrap().clone()
    }

    /// Store a value under `cache_key`, then `group`, then `name`.
    pub fn store_nested(&self, cache_key: &str, group: &str, name: &str, value: Value) {
        let mut values = self.values.lock().unwrap();
        let outer = values.entry(cache_key).or_insert_with(|| json!({}));
        if !outer.is_object() {
            *outer = json!({});
        }
        let inner = outer
            .as_object_mut()
            .expect("an object")
            .entry(group)
            .or_insert_with(|| json!({}));
        if !inner.is_object() {
            *inner = json!({});
        }
        inner
            .as_object_mut()
            .expect("an object")
            .insert(name.to_string(), value);
    }

    /// The value under `cache_key`, then `group`, then `name`, if there is one.
    pub fn get_nested(&self, cache_key: &str, group: &str, name: &str) -> Option<Value> {
        let values = self.values.lock().unwrap();
        values.get(cache_key)?.get(group)?.get(name).cloned()
    }

    /// Ask CamillaDSP for the values at most once a second, however many
    /// browsers poll. The processing state is not here, the browsers get it
    /// from `/api/state` as it changes.
    pub async fn refresh(self: &Arc<Self>, camilla: &Arc<CamillaClient>) -> Value {
        if let Err(err) = self.query_all(camilla).await {
            log::debug!("Status query failed: {err}");
            self.set_offline();
        }
        self.snapshot()
    }

    async fn query_all(self: &Arc<Self>, camilla: &Arc<CamillaClient>) -> Result<(), DspError> {
        let due = match *self.last_refresh.lock().unwrap() {
            Some(last) => last.elapsed() > SLOW_REFRESH,
            None => true,
        };
        if !due {
            return Ok(());
        }
        *self.last_refresh.lock().unwrap() = Some(Instant::now());
        let capture_rate = value(camilla.capture_rate().await)?.and_then(nearest_standard_rate);
        let update = json!({
            "cdsp_online": true,
            "capturerate": capture_rate,
            "rateadjust": to_json(&value(camilla.rate_adjust().await)?),
            "bufferlevel": value(camilla.buffer_level().await)?,
            "clippedsamples": value(camilla.clipped_samples().await)?,
            "processingload": to_json(&value(camilla.processing_load().await)?),
            "resamplerload": to_json(&value(camilla.resampler_load().await)?),
            "labels": value(camilla.channel_labels().await)?,
            "title": value(camilla.config_title().await)?,
            "description": value(camilla.config_description().await)?,
        });
        let connection = camilla.connection();
        if self.connection.swap(connection, Ordering::Relaxed) != connection {
            self.on_reconnect(camilla).await?;
        }
        self.merge(update);
        Ok(())
    }

    /// Read what does not change while CamillaDSP runs: its version, and the
    /// device types and devices it has. The device lists can be slow to make,
    /// so they are fetched in the background.
    async fn on_reconnect(self: &Arc<Self>, camilla: &Arc<CamillaClient>) -> Result<(), DspError> {
        let version = camilla.version().await?;
        self.merge(json!({"cdsp_version": version}));
        let cache = self.clone();
        let camilla = camilla.clone();
        tokio::spawn(async move {
            if let Err(err) = cache.refresh_devices(&camilla).await {
                log::debug!("Could not read the device lists: {err}");
            }
        });
        Ok(())
    }

    async fn refresh_devices(&self, camilla: &CamillaClient) -> Result<(), DspError> {
        let (playback_types, capture_types) = camilla.supported_device_types().await?;
        log::debug!("Updated backends: {playback_types:?}, {capture_types:?}");
        self.merge(json!({"backends": [playback_types, capture_types]}));
        *self.device_types.lock().unwrap() = Some(DeviceTypeLists {
            playback: playback_types.clone(),
            capture: capture_types.clone(),
        });
        for backend in &playback_types {
            let devices = camilla.playback_devices(backend).await?;
            log::debug!("Updated {backend} playback devices: {devices:?}");
            self.store_list("playback_devices", backend, devices);
        }
        for backend in &capture_types {
            let devices = camilla.capture_devices(backend).await?;
            log::debug!("Updated {backend} capture devices: {devices:?}");
            self.store_list("capture_devices", backend, devices);
        }
        Ok(())
    }

    pub fn store_list(&self, cache_key: &str, backend: &str, devices: Vec<(String, String)>) {
        let mut values = self.values.lock().unwrap();
        let entry = values.entry(cache_key).or_insert_with(|| json!({}));
        if let Some(map) = entry.as_object_mut() {
            map.insert(backend.to_string(), json!(devices));
        }
    }
}

/// A value that CamillaDSP declines to give, for example with no config
/// loaded, is shown as missing. Only a lost connection means offline.
fn value<T>(result: Result<T, DspError>) -> Result<Option<T>, DspError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(DspError::Command { result, message }) => {
            log::debug!("Status query failed with {result}: {message}");
            Ok(None)
        }
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_rate_is_rounded_to_a_standard_rate() {
        assert_eq!(nearest_standard_rate(44100), Some(44100));
        assert_eq!(nearest_standard_rate(44300), Some(44100));
        assert_eq!(nearest_standard_rate(47900), Some(48000));
        assert_eq!(nearest_standard_rate(0), None);
        assert_eq!(nearest_standard_rate(60000), None);
        assert_eq!(nearest_standard_rate(1_000_000), None);
    }
}
