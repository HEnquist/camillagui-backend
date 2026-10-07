//! The status sent to the frontend by `GET /api/status`, and what has been
//! read from CamillaDSP about its devices, kept for when it cannot be asked.

use crate::camilla::{CamillaClient, DspError};
use crate::validate::DeviceTypeLists;
use camilladsp_config::protocol::{AudioDeviceDescriptor, ChannelLabels};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use utoipa::ToSchema;

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

/// What `GET /api/status` answers. The processing state is not here, it comes
/// from `/api/state` as it changes. A value CamillaDSP declines to give, for
/// example with no config loaded, is null, and so is every value while it is
/// offline.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct Status {
    /// Whether CamillaDSP answered the last time it was asked.
    pub cdsp_online: bool,
    /// CamillaDSP's version, `(offline)` until it has been reached.
    pub cdsp_version: String,
    /// The version of this backend.
    pub backend_version: String,
    /// The capture rate in Hz, rounded to the nearest standard rate. Null when
    /// it is not within 4% of one.
    #[schema(required)]
    pub capturerate: Option<usize>,
    #[schema(required)]
    pub rateadjust: Option<f32>,
    #[schema(required)]
    pub bufferlevel: Option<usize>,
    #[schema(required)]
    pub clippedsamples: Option<usize>,
    /// In percent.
    #[schema(required)]
    pub processingload: Option<f32>,
    /// In percent.
    #[schema(required)]
    pub resamplerload: Option<f32>,
    pub labels: ChannelLabels,
    #[schema(required)]
    pub title: Option<String>,
    #[schema(required)]
    pub description: Option<String>,
}

impl Status {
    fn offline() -> Self {
        Status {
            cdsp_online: false,
            cdsp_version: "(offline)".to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            capturerate: None,
            rateadjust: None,
            bufferlevel: None,
            clippedsamples: None,
            processingload: None,
            resamplerload: None,
            labels: ChannelLabels::default(),
            title: None,
            description: None,
        }
    }
}

/// What has been read about the devices, by backend.
#[derive(Default)]
struct Devices {
    types: Option<DeviceTypeLists>,
    playback: HashMap<String, Vec<(String, String)>>,
    capture: HashMap<String, Vec<(String, String)>>,
    /// Keyed on backend and device.
    playback_capabilities: HashMap<(String, String), Arc<AudioDeviceDescriptor>>,
    capture_capabilities: HashMap<(String, String), Arc<AudioDeviceDescriptor>>,
}

pub struct StatusCache {
    status: Mutex<Status>,
    last_refresh: Mutex<Option<Instant>>,
    /// The client connection the version and device lists were read on, 0
    /// for none. When the client has made a new one, they are read again.
    connection: AtomicU64,
    devices: Mutex<Devices>,
}

impl StatusCache {
    pub fn new() -> Self {
        StatusCache {
            status: Mutex::new(Status::offline()),
            last_refresh: Mutex::new(None),
            connection: AtomicU64::new(0),
            devices: Mutex::new(Devices::default()),
        }
    }

    fn set_offline(&self) {
        {
            let mut status = self.status.lock().unwrap();
            let labels = std::mem::take(&mut status.labels);
            *status = Status {
                labels,
                ..Status::offline()
            };
        }
        *self.last_refresh.lock().unwrap() = None;
        self.connection.store(0, Ordering::Relaxed);
    }

    /// The device types the connected CamillaDSP supports, once known.
    pub fn device_types(&self) -> Option<DeviceTypeLists> {
        self.devices.lock().unwrap().types.clone()
    }

    /// The devices of a backend, as last read.
    pub fn device_list(&self, capture: bool, backend: &str) -> Option<Vec<(String, String)>> {
        let devices = self.devices.lock().unwrap();
        let lists = if capture {
            &devices.capture
        } else {
            &devices.playback
        };
        lists.get(backend).cloned()
    }

    fn store_device_list(&self, capture: bool, backend: &str, list: Vec<(String, String)>) {
        let mut devices = self.devices.lock().unwrap();
        let lists = if capture {
            &mut devices.capture
        } else {
            &mut devices.playback
        };
        lists.insert(backend.to_string(), list);
    }

    /// The capabilities of a device, as last read.
    pub fn capabilities(
        &self,
        capture: bool,
        backend: &str,
        device: &str,
    ) -> Option<Arc<AudioDeviceDescriptor>> {
        let devices = self.devices.lock().unwrap();
        let cache = if capture {
            &devices.capture_capabilities
        } else {
            &devices.playback_capabilities
        };
        cache
            .get(&(backend.to_string(), device.to_string()))
            .cloned()
    }

    pub fn store_capabilities(
        &self,
        capture: bool,
        backend: &str,
        device: &str,
        value: Arc<AudioDeviceDescriptor>,
    ) {
        let mut devices = self.devices.lock().unwrap();
        let cache = if capture {
            &mut devices.capture_capabilities
        } else {
            &mut devices.playback_capabilities
        };
        cache.insert((backend.to_string(), device.to_string()), value);
    }

    /// Ask CamillaDSP for the values at most once a second, however many
    /// browsers poll.
    pub async fn refresh(self: &Arc<Self>, camilla: &Arc<CamillaClient>) -> Status {
        if let Err(err) = self.query_all(camilla).await {
            log::debug!("Status query failed: {err}");
            self.set_offline();
        }
        self.status.lock().unwrap().clone()
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
        let capturerate = value(camilla.capture_rate().await)?.and_then(nearest_standard_rate);
        let rateadjust = value(camilla.rate_adjust().await)?;
        let bufferlevel = value(camilla.buffer_level().await)?;
        let clippedsamples = value(camilla.clipped_samples().await)?;
        let processingload = value(camilla.processing_load().await)?;
        let resamplerload = value(camilla.resampler_load().await)?;
        let labels = value(camilla.channel_labels().await)?.unwrap_or_default();
        let title = value(camilla.config_title().await)?;
        let description = value(camilla.config_description().await)?;
        let connection = camilla.connection();
        if self.connection.swap(connection, Ordering::Relaxed) != connection {
            self.on_reconnect(camilla).await?;
        }
        let mut status = self.status.lock().unwrap();
        status.cdsp_online = true;
        status.capturerate = capturerate;
        status.rateadjust = rateadjust;
        status.bufferlevel = bufferlevel;
        status.clippedsamples = clippedsamples;
        status.processingload = processingload;
        status.resamplerload = resamplerload;
        status.labels = labels;
        status.title = title;
        status.description = description;
        Ok(())
    }

    /// Read what does not change while CamillaDSP runs: its version, and the
    /// device types and devices it has. The device lists can be slow to make,
    /// so they are fetched in the background.
    async fn on_reconnect(self: &Arc<Self>, camilla: &Arc<CamillaClient>) -> Result<(), DspError> {
        let version = camilla.version().await?;
        self.status.lock().unwrap().cdsp_version = version;
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
        self.devices.lock().unwrap().types = Some(DeviceTypeLists {
            playback: playback_types.clone(),
            capture: capture_types.clone(),
        });
        for backend in &playback_types {
            let devices = camilla.playback_devices(backend).await?;
            log::debug!("Updated {backend} playback devices: {devices:?}");
            self.store_device_list(false, backend, devices);
        }
        for backend in &capture_types {
            let devices = camilla.capture_devices(backend).await?;
            log::debug!("Updated {backend} capture devices: {devices:?}");
            self.store_device_list(true, backend, devices);
        }
        Ok(())
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
