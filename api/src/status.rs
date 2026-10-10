//! The status sent to the frontend by `GET /api/status`, and what has been
//! read from CamillaDSP about its devices, kept for when it cannot be asked.

use crate::camilla::{CamillaClient, DspError};
use crate::validate::DeviceTypeLists;
use camilladsp_schema::protocol::{AudioDeviceDescriptor, ChannelLabels};
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
/// from `/api/events` as it changes. A value CamillaDSP declines to give, for
/// example with no config loaded, is null, and so is every value while it is
/// offline.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct Status {
    /// Whether CamillaDSP answered the last time it was asked.
    pub cdsp_online: bool,
    /// CamillaDSP's version, null while it is offline.
    #[schema(required)]
    pub cdsp_version: Option<String>,
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
            cdsp_version: None,
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
        // Stored only once on_reconnect is through, so that a poll dropped
        // halfway, by a page reload, leaves it for the next one. Two polls may
        // both run it, which only reads the same values twice.
        let connection = camilla.connection();
        if self.connection.load(Ordering::Relaxed) != connection {
            self.on_reconnect(camilla).await?;
            self.connection.store(connection, Ordering::Relaxed);
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
        self.status.lock().unwrap().cdsp_version = Some(version);
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
        // A backend that cannot list its devices, like Jack with no server
        // running, must not keep the others from being cached. A lost
        // connection ends it.
        for backend in &playback_types {
            match camilla.playback_devices(backend).await {
                Ok(devices) => {
                    log::debug!("Updated {backend} playback devices: {devices:?}");
                    self.store_device_list(false, backend, devices);
                }
                Err(err @ DspError::Command { .. }) => {
                    log::debug!("Could not read the {backend} playback devices: {err}");
                }
                Err(err) => return Err(err),
            }
        }
        for backend in &capture_types {
            match camilla.capture_devices(backend).await {
                Ok(devices) => {
                    log::debug!("Updated {backend} capture devices: {devices:?}");
                    self.store_device_list(true, backend, devices);
                }
                Err(err @ DspError::Command { .. }) => {
                    log::debug!("Could not read the {backend} capture devices: {err}");
                }
                Err(err) => return Err(err),
            }
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

    /// A fake CamillaDSP with Jack and Alsa, where Jack cannot list devices.
    /// It answers the config description after a delay, and the state after a
    /// longer one, so that a status poll can be held up behind a request.
    async fn fake_camilladsp() -> u16 {
        use camilladsp_schema::protocol::{ProcessingState, WsCommand, WsReply, WsResult};
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    while let Some(Ok(Message::Text(text))) = ws.next().await {
                        let no_jack = || WsResult::ConfigValidationError {
                            message: "No jack server".to_string(),
                        };
                        let alsa = || vec![("hw:0".to_string(), "Card".to_string())];
                        let reply = match serde_json::from_str(&text).unwrap() {
                            WsCommand::GetVersion => WsReply::GetVersion {
                                result: WsResult::Ok,
                                value: "5.0.0".to_string(),
                            },
                            WsCommand::GetSupportedDeviceTypes => {
                                WsReply::GetSupportedDeviceTypes {
                                    result: WsResult::Ok,
                                    value: (
                                        vec!["Jack".to_string(), "Alsa".to_string()],
                                        vec!["Jack".to_string(), "Alsa".to_string()],
                                    ),
                                }
                            }
                            WsCommand::GetAvailablePlaybackDevices { backend } => {
                                let jack = backend == "Jack";
                                WsReply::GetAvailablePlaybackDevices {
                                    result: if jack { no_jack() } else { WsResult::Ok },
                                    value: if jack { vec![] } else { alsa() },
                                }
                            }
                            WsCommand::GetAvailableCaptureDevices { backend } => {
                                let jack = backend == "Jack";
                                WsReply::GetAvailableCaptureDevices {
                                    result: if jack { no_jack() } else { WsResult::Ok },
                                    value: if jack { vec![] } else { alsa() },
                                }
                            }
                            WsCommand::GetCaptureRate => WsReply::GetCaptureRate {
                                result: WsResult::Ok,
                                value: 44100,
                            },
                            WsCommand::GetRateAdjust => WsReply::GetRateAdjust {
                                result: WsResult::Ok,
                                value: 1.0,
                            },
                            WsCommand::GetBufferLevel => WsReply::GetBufferLevel {
                                result: WsResult::Ok,
                                value: 0,
                            },
                            WsCommand::GetClippedSamples => WsReply::GetClippedSamples {
                                result: WsResult::Ok,
                                value: 0,
                            },
                            WsCommand::GetProcessingLoad => WsReply::GetProcessingLoad {
                                result: WsResult::Ok,
                                value: 0.0,
                            },
                            WsCommand::GetResamplerLoad => WsReply::GetResamplerLoad {
                                result: WsResult::Ok,
                                value: 0.0,
                            },
                            WsCommand::GetChannelLabels => WsReply::GetChannelLabels {
                                result: WsResult::Ok,
                                value: ChannelLabels::default(),
                            },
                            WsCommand::GetConfigTitle => WsReply::GetConfigTitle {
                                result: WsResult::Ok,
                                value: "Title".to_string(),
                            },
                            WsCommand::GetConfigDescription => {
                                tokio::time::sleep(Duration::from_millis(100)).await;
                                WsReply::GetConfigDescription {
                                    result: WsResult::Ok,
                                    value: "Description".to_string(),
                                }
                            }
                            WsCommand::GetState => {
                                tokio::time::sleep(Duration::from_millis(200)).await;
                                WsReply::GetState {
                                    result: WsResult::Ok,
                                    value: ProcessingState::Running,
                                }
                            }
                            command => panic!("unexpected command {command:?}"),
                        };
                        let text = serde_json::to_string(&reply).unwrap();
                        ws.send(Message::text(text)).await.unwrap();
                    }
                });
            }
        });
        port
    }

    #[tokio::test]
    async fn failing_backend_does_not_stop_the_others_from_being_cached() {
        let port = fake_camilladsp().await;
        let camilla = CamillaClient::new("127.0.0.1", port);
        let cache = StatusCache::new();
        cache.refresh_devices(&camilla).await.unwrap();
        let alsa = vec![("hw:0".to_string(), "Card".to_string())];
        assert_eq!(cache.device_list(false, "Jack"), None);
        assert_eq!(cache.device_list(false, "Alsa"), Some(alsa.clone()));
        assert_eq!(cache.device_list(true, "Jack"), None);
        assert_eq!(cache.device_list(true, "Alsa"), Some(alsa));
    }

    #[tokio::test]
    async fn dropped_poll_leaves_the_reconnect_for_the_next() {
        let port = fake_camilladsp().await;
        let camilla = Arc::new(CamillaClient::new("127.0.0.1", port));
        let cache = Arc::new(StatusCache::new());
        // The first poll is held up in on_reconnect, waiting for the socket
        // while another request has it, and is dropped there, like the
        // handler of a reloaded page.
        let poll = tokio::time::timeout(Duration::from_millis(250), cache.refresh(&camilla));
        let meanwhile = async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            camilla.state().await
        };
        let (poll, meanwhile) = tokio::join!(poll, meanwhile);
        assert!(poll.is_err());
        meanwhile.unwrap();
        // Dropped while waiting, not halfway through a request, so the
        // connection is still the same.
        assert_eq!(camilla.connection(), 1);
        // The next poll reads the version, rather than take it as read.
        *cache.last_refresh.lock().unwrap() = None;
        let status = cache.refresh(&camilla).await;
        assert!(status.cdsp_online);
        assert_eq!(status.cdsp_version.as_deref(), Some("5.0.0"));
    }
}
