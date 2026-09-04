import React, { useEffect, useState } from "react"
import "./index.css"
import { mdiFileSearch, mdiMagnify, mdiTune } from "@mdi/js"
import { Range } from "immutable"
import {
  AlsaFormat,
  AsioFormat,
  AsyncPolyDegreeOptions,
  AsyncSincInterpolationOptions,
  AsyncSincProfile,
  AsyncSincProfiles,
  AsyncSincWindow,
  AsyncSincWindows,
  BinaryFormat,
  CaptureDevice,
  Config,
  CoreAudioFormat,
  defaultResampler,
  defaultSincResampler,
  Devices,
  getCaptureDeviceChannelCount,
  PlaybackDevice,
  Resampler,
  ResamplerType,
  ResamplerTypeOptions,
  getFormatOptions,
  WasapiFormat,
  Signals,
} from "./camilladsp/config"
import { DeviceCapabilities, DeviceCapabilitiesPopup } from "./devicecapabilitiespopup"
import { CaptureType, GuiConfig, PlaybackType } from "./guiconfig"
import { Update } from "./utilities/common"
import { Errors } from "./utilities/errors"
import { FileInfo, loadFiles } from "./utilities/files"
import {
  add_default_option_inplace,
  Box,
  default_to_null,
  EnumInput,
  EnumOption,
  ErrorBoundary,
  ErrorMessage,
  FileSelectPopup,
  InputWithIcon,
  IntInput,
  IntOption,
  KeyValueSelectPopup,
  LabelListOption,
  MdiButton,
  null_to_default,
  OptionalBoolOption,
  FloatOption,
  OptionalFloatOption,
  OptionalIntInput,
  OptionalIntOption,
  OptionalTextInput,
  OptionalTextOption,
  TextInput,
  TextOption,
} from "./utilities/ui-components"

function getEffectiveCaptureSamplerate(devices: Devices): number | null {
  if (devices.resampler !== null) {
    return devices.capture_samplerate
  }
  return devices.samplerate
}

function getEffectivePlaybackSamplerate(devices: Devices): number {
  return devices.samplerate
}

function getCaptureSamplerateDescription(devices: Devices): string {
  if (devices.resampler !== null) {
    if (devices.capture_samplerate !== null) {
      return `Currently selecting values for ${devices.capture_samplerate} Hz from capture_samplerate.`
    }
    return "Currently selecting values from capture_samplerate."
  }
  return `Currently selecting values for ${devices.samplerate} Hz from samplerate.`
}

function getPlaybackSamplerateDescription(devices: Devices): string {
  return `Currently selecting values for ${devices.samplerate} Hz from samplerate.`
}

// TODO redo resampler config

export function DevicesTab(props: {
  guiConfig: GuiConfig
  devices: Devices
  errors: Errors
  updateConfig: (update: Update<Config>) => void
}) {
  const updateDevices = (update: Update<Devices>) => props.updateConfig((config) => update(config.devices))
  const { guiConfig, devices, errors } = props
  const [availableBackends, setAvailableBackends] = useState([
    guiConfig.supported_playback_types,
    guiConfig.supported_capture_types,
  ])
  useEffect(() => {
    fetch("/api/backends").then((response) => {
      if (response.ok) return response.json().then((backends) => setAvailableBackends(backends))
    })
  }, [])
  return (
    <ErrorBoundary errorMessage={errors.asText()}>
      <div className="tabcontainer">
        <div className="tabpanel">
          <ErrorMessage message={errors.rootMessage()} />
          <Samplerate
            hide_capture_samplerate={guiConfig.hide_capture_samplerate}
            devices={devices}
            errors={errors}
            onChange={updateDevices}
          />
          <BufferOptions devices={devices} errors={errors} onChange={updateDevices} />
          <SilenceOptions
            hide_silence={guiConfig.hide_silence}
            devices={devices}
            errors={errors}
            onChange={updateDevices}
          />
          <RateAdjustOptions devices={devices} errors={errors} onChange={updateDevices} />
          <ResamplingOptions
            hide_capture_samplerate={guiConfig.hide_capture_samplerate}
            devices={devices}
            errors={errors}
            onChange={updateDevices}
          />
          <RateMonitoringOptions
            hide_rate_monitoring={guiConfig.hide_rate_monitoring}
            devices={devices}
            errors={errors}
            onChange={updateDevices}
          />
          <VolumeOptions devices={devices} errors={errors} onChange={updateDevices} />
          <MultithreadingOptions
            hide_multithreading={guiConfig.hide_multithreading}
            devices={devices}
            errors={errors}
            onChange={updateDevices}
          />
          <CaptureOptions
            hide_capture_device={guiConfig.hide_capture_device}
            supported_capture_types={availableBackends[1] as CaptureType[]}
            devices={devices}
            capture={devices.capture}
            errors={errors.forSubpath("capture")}
            onChange={updateDevices}
            audiofilesSupported={guiConfig.audiofiles_supported}
            allowAbsolutePaths={guiConfig.allow_absolute_paths}
          />
          <PlaybackOptions
            hide_playback_device={guiConfig.hide_playback_device}
            supported_playback_types={availableBackends[0] as PlaybackType[]}
            devices={devices}
            playback={devices.playback}
            errors={errors.forSubpath("playback")}
            onChange={updateDevices}
            audiofilesSupported={guiConfig.audiofiles_supported}
            allowAbsolutePaths={guiConfig.allow_absolute_paths}
          />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

function Samplerate(props: {
  hide_capture_samplerate: boolean
  devices: Devices
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_capture_samplerate && props.devices.resampler !== null) return null
  return (
    <SamplerateOption
      samplerate={props.devices.samplerate}
      error={props.errors.messageFor("samplerate")}
      desc="samplerate"
      tooltip="Sample rate for processing and output"
      onChange={(samplerate) =>
        props.onChange((devices) => {
          devices.samplerate = samplerate
        })
      }
      extraPadding={true}
    />
  )
}

function SamplerateOption(props: {
  samplerate: number
  error?: string
  desc: string
  tooltip: string
  onChange: (samplerate: number) => void
  extraPadding?: boolean
}) {
  const defaultSampleRates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]
  function isNonDefaultSamplerate(samplerate: number): boolean {
    return !defaultSampleRates.includes(samplerate)
  }
  const other = "Other"
  const samplerate = props.samplerate
  const padding = props.extraPadding ? "0 12px" : "0"
  return (
    <div className="setting" data-tooltip-html-={props.tooltip} style={{ padding: padding }}>
      <label htmlFor={props.desc} className="setting-label">
        {props.desc}
      </label>
      <EnumInput
        value={isNonDefaultSamplerate(samplerate) ? other : samplerate.toString()}
        options={defaultSampleRates.map((samplerate) => samplerate.toString()).concat([other])}
        desc={props.desc}
        tooltip={props.tooltip}
        style={{
          width: isNonDefaultSamplerate(samplerate) ? "40%" : "100%",
        }}
        className="setting-input"
        onChange={(value) => {
          const parsed = parseInt(value)
          const newSamplerate = isNaN(parsed) ? 0 : parsed
          props.onChange(newSamplerate)
        }}
      />
      {isNonDefaultSamplerate(samplerate) && (
        <IntInput
          value={samplerate}
          tooltip={props.tooltip}
          className="setting-input"
          style={{ width: "60%" }}
          onChange={(samplerate) => props.onChange(samplerate)}
        />
      )}
      <ErrorMessage message={props.error} />
    </div>
  )
}

function OptionalSamplerateOption(props: {
  samplerate: number | null
  error?: string
  desc: string
  tooltip: string
  onChange: (samplerate: number | null) => void
  extraPadding?: boolean
}) {
  const defaultSampleRates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]
  function isNonDefaultSamplerate(samplerate: number | null): boolean {
    return samplerate !== null && !defaultSampleRates.includes(samplerate)
  }
  const other = "Other"
  const samplerate = props.samplerate
  const padding = props.extraPadding ? "0 12px" : "0"
  let value: null | string
  if (samplerate === null) value = null
  else if (isNonDefaultSamplerate(samplerate)) value = other
  else value = samplerate.toString()
  const options = defaultSampleRates.map((samplerate) => samplerate.toString()).concat([other])
  add_default_option_inplace(options, "default")
  return (
    <div
      className="setting"
      data-tooltip-html={props.tooltip}
      data-tooltip-id="main-tooltip"
      style={{ padding: padding }}
    >
      <label htmlFor={props.desc} className="setting-label">
        {props.desc}
      </label>
      <EnumInput
        value={null_to_default(value, "default")}
        options={options}
        desc={props.desc}
        tooltip={props.tooltip}
        style={{
          width: isNonDefaultSamplerate(samplerate) ? "40%" : "100%",
        }}
        className="setting-input"
        onChange={(value: string) => {
          const parsed = default_to_null(value, "default") ? parseInt(value) : null
          const newSamplerate = parsed !== null && isNaN(parsed) ? 0 : parsed
          props.onChange(newSamplerate)
        }}
      />
      {isNonDefaultSamplerate(samplerate) && (
        <OptionalIntInput
          value={samplerate}
          tooltip={props.tooltip}
          className="setting-input"
          style={{ width: "60%" }}
          onChange={(samplerate: number | null) => props.onChange(samplerate)}
        />
      )}
      <ErrorMessage message={props.error} />
    </div>
  )
}

function BufferOptions(props: { devices: Devices; errors: Errors; onChange: (update: Update<Devices>) => void }) {
  return (
    <Box title="Buffers">
      <IntOption
        value={props.devices.chunksize}
        error={props.errors.messageFor("chunksize")}
        desc="chunksize"
        tooltip="Chunksize for the processing"
        onChange={(chunksize) => props.onChange((devices) => (devices.chunksize = chunksize))}
      />
      <OptionalIntOption
        value={props.devices.queuelimit}
        error={props.errors.messageFor("queuelimit")}
        desc="queuelimit"
        tooltip="Length limit for internal queues"
        onChange={(queuelimit) => props.onChange((devices) => (devices.queuelimit = queuelimit))}
      />
    </Box>
  )
}

function SilenceOptions(props: {
  hide_silence: boolean
  devices: Devices
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_silence) return null
  return (
    <Box title="Silence">
      <OptionalFloatOption
        value={props.devices.silence_threshold}
        error={props.errors.messageFor("silence_threshold")}
        desc="silence_threshold"
        tooltip="Threshold for silence in dB"
        onChange={(silenceThreshold) => props.onChange((devices) => (devices.silence_threshold = silenceThreshold))}
      />
      <OptionalFloatOption
        value={props.devices.silence_timeout_s}
        error={props.errors.messageFor("silence_timeout_s")}
        desc="silence_timeout_s"
        tooltip="Pause processing after this many seconds of silence"
        onChange={(silenceTimeout) => props.onChange((devices) => (devices.silence_timeout_s = silenceTimeout))}
      />
    </Box>
  )
}

function RateAdjustOptions(props: { devices: Devices; errors: Errors; onChange: (update: Update<Devices>) => void }) {
  const playbackDeviceIsOneOf = (types: string[]) => types.includes(props.devices.playback.type)
  if (playbackDeviceIsOneOf(["File", "Stdout"])) return null
  return (
    <Box title="Rate adjust">
      <OptionalBoolOption
        value={props.devices.enable_rate_adjust}
        error={props.errors.messageFor("enable_rate_adjust")}
        desc="enable_rate_adjust"
        tooltip="Enable rate adjust"
        onChange={(enableRateAdjust) => props.onChange((devices) => (devices.enable_rate_adjust = enableRateAdjust))}
      />
      <OptionalFloatOption
        value={props.devices.adjust_interval_s}
        error={props.errors.messageFor("adjust_interval_s")}
        desc="adjust_interval_s"
        tooltip="Delay in seconds between rate adjustments"
        onChange={(adjustInterval) => props.onChange((devices) => (devices.adjust_interval_s = adjustInterval))}
      />
      <OptionalIntOption
        value={props.devices.target_level}
        error={props.errors.messageFor("target_level")}
        desc="target_level"
        tooltip="Target output buffer fill level for rate adjust"
        onChange={(targetLevel) => props.onChange((devices) => (devices.target_level = targetLevel))}
      />
    </Box>
  )
}

function changeResamplerType(newType: ResamplerType | null): Resampler | null {
  if (newType === null) {
    return null
  }
  return defaultResampler(newType)
}

function changeResamplerProfile(profile: AsyncSincProfile): Resampler {
  return defaultSincResampler(profile)
}

function ResamplingOptions(props: {
  hide_capture_samplerate: boolean
  devices: Devices
  errors: Errors
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  const { devices, errors } = props
  return (
    <Box title="Resampling">
      <EnumOption
        value={devices.resampler ? devices.resampler.type : null}
        error={errors.messageFor("resampler", "type")}
        options={ResamplerTypeOptions}
        desc="resampler_type"
        tooltip="Resampler type"
        onChange={(resamplerType) =>
          props.onChange((devices) => (devices.resampler = changeResamplerType(resamplerType)))
        }
      />
      {devices.resampler && devices.resampler.type === "AsyncSinc" && (
        <EnumOption
          value={"profile" in devices.resampler ? devices.resampler.profile : "Free"}
          error={errors.messageFor("resampler", "profile")}
          options={AsyncSincProfiles}
          desc="profile"
          tooltip="AsyncSinc resampler profile"
          onChange={(profile) => props.onChange((devices) => (devices.resampler = changeResamplerProfile(profile)))}
        />
      )}
      {devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler) && (
        <>
          <EnumOption
            value={devices.resampler.interpolation}
            error={errors.messageFor("interpolation")}
            options={AsyncSincInterpolationOptions}
            desc="interpolation"
            tooltip="Interpolation order"
            onChange={(interp) =>
              props.onChange((devices) => {
                if (devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler)) {
                  devices.resampler.interpolation = interp
                }
              })
            }
          />
          <IntOption
            value={devices.resampler.sinc_len}
            error={errors.messageFor("resampler", "sinc_len")}
            desc="sinc_len"
            tooltip="Length of sinc interpolation filter"
            onChange={(len) =>
              props.onChange((devices) => {
                if (devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler)) {
                  devices.resampler.sinc_len = len
                }
              })
            }
          />
          <IntOption
            value={devices.resampler.oversampling_factor}
            error={errors.messageFor("resampler", "oversampling_factor")}
            desc="oversampling_factor"
            tooltip="Oversampling factor"
            onChange={(factor) =>
              props.onChange((devices) => {
                if (devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler)) {
                  devices.resampler.oversampling_factor = factor
                }
              })
            }
          />
          <OptionalFloatOption
            value={devices.resampler.f_cutoff}
            error={errors.messageFor("f_cutoff")}
            desc="f_cutoff"
            tooltip="Relative cutoff frequency of interpolation filter"
            onChange={(cutoff) =>
              props.onChange((devices) => {
                if (devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler)) {
                  devices.resampler.f_cutoff = cutoff
                }
              })
            }
          />
          <EnumOption
            value={devices.resampler.window}
            error={errors.messageFor("window")}
            options={AsyncSincWindows}
            desc="window"
            tooltip="Window function for interpolation filter"
            onChange={(window) =>
              props.onChange((devices) => {
                if (devices.resampler && devices.resampler.type === "AsyncSinc" && !("profile" in devices.resampler)) {
                  devices.resampler.window = window as AsyncSincWindow
                }
              })
            }
          />
        </>
      )}
      {devices.resampler && devices.resampler.type === "AsyncPoly" && (
        <EnumOption
          value={devices.resampler.interpolation}
          error={errors.messageFor("interpolation")}
          options={AsyncPolyDegreeOptions}
          desc="interpolation"
          tooltip="Interpolation order"
          onChange={(interp) =>
            props.onChange((devices) => {
              if (devices.resampler?.type === "AsyncPoly") {
                devices.resampler.interpolation = interp
              }
            })
          }
        />
      )}
      {!props.hide_capture_samplerate && devices.resampler !== null && (
        <OptionalSamplerateOption
          samplerate={devices.capture_samplerate}
          error={errors.messageFor("capture_samplerate")}
          desc="capture_samplerate"
          tooltip="Sample rate for capture device.<br>If different from 'samplerate' then resampling must be enabled"
          onChange={(captureSamplerate) =>
            props.onChange((devices) => (devices.capture_samplerate = captureSamplerate))
          }
        />
      )}
    </Box>
  )
}

function RateMonitoringOptions(props: {
  hide_rate_monitoring: boolean
  devices: Devices
  errors: Errors
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_rate_monitoring) return null
  return (
    <Box title="Capture rate monitoring">
      <OptionalFloatOption
        value={props.devices.rate_measure_interval_s}
        error={props.errors.messageFor("rate_measure_interval_s")}
        desc="rate_measure_interval_s"
        tooltip="Interval for rate measurements, in seconds"
        onChange={(rateMeasureInterval) =>
          props.onChange((devices) => (devices.rate_measure_interval_s = rateMeasureInterval))
        }
      />
      <OptionalBoolOption
        value={props.devices.stop_on_rate_change}
        error={props.errors.messageFor("stop_on_rate_change")}
        desc="stop_on_rate_change"
        tooltip="Stop processing when a sample rate change is detected"
        onChange={(stopOnRateChange) => props.onChange((devices) => (devices.stop_on_rate_change = stopOnRateChange))}
      />
    </Box>
  )
}

function MultithreadingOptions(props: {
  hide_multithreading: boolean
  devices: Devices
  errors: Errors
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_multithreading) return null
  return (
    <Box title="Multithreaded processing">
      <OptionalBoolOption
        value={props.devices.multithreaded}
        error={props.errors.messageFor("multithreaded")}
        desc="multithreaded"
        tooltip="Enable multithreaded processing of filters"
        onChange={(multithreaded) => props.onChange((devices) => (devices.multithreaded = multithreaded))}
      />
      <OptionalIntOption
        value={props.devices.worker_threads}
        error={props.errors.messageFor("worker_threads")}
        desc="worker_threads"
        tooltip="Number of worker threads for filter processing"
        onChange={(workerThreads) => props.onChange((devices) => (devices.worker_threads = workerThreads))}
      />
    </Box>
  )
}

function VolumeOptions(props: {
  devices: Devices
  errors: Errors
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  return (
    <Box title="Volume control settings">
      <OptionalFloatOption
        value={props.devices.volume_ramp_time_ms}
        error={props.errors.messageFor("volume_ramp_time_ms")}
        desc="volume_ramp_time_ms"
        tooltip="Ramp time for main volume control, in milliseconds"
        onChange={(volumeRampTime) => props.onChange((devices) => (devices.volume_ramp_time_ms = volumeRampTime))}
      />
      <OptionalFloatOption
        value={props.devices.volume_limit}
        error={props.errors.messageFor("volume_limit")}
        desc="volume_limit"
        tooltip="Upper limit for main volume control, in dB"
        onChange={(volumeLimit) => props.onChange((devices) => (devices.volume_limit = volumeLimit))}
      />
    </Box>
  )
}

function CaptureOptions(props: {
  hide_capture_device: boolean
  supported_capture_types?: CaptureType[]
  devices: Devices
  capture: CaptureDevice
  errors: Errors
  onChange: (update: Update<Devices>) => void
  audiofilesSupported?: boolean
  allowAbsolutePaths?: boolean
}) {
  const [popupState, setPopupState] = useState(false)
  const [availableDevices, setAvailableDevices] = useState([])
  const [capabilitiesPopupState, setCapabilitiesPopupState] = useState(false)
  const [deviceCapabilities, setDeviceCapabilities] = useState<DeviceCapabilities | null>(null)
  const [deviceCapabilitiesError, setDeviceCapabilitiesError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [captureFilePickerOpen, setCaptureFilePickerOpen] = useState(false)
  const [availableCaptureFiles, setAvailableCaptureFiles] = useState<FileInfo[]>([])
  const [channels, setChannels] = useState(props.capture.type !== "WavFile" ? props.capture.channels : 2)
  const defaults: { [type: string]: CaptureDevice } = {
    Alsa: {
      type: "Alsa",
      channels: 2,
      format: null,
      device: "hw:0",
      stop_on_inactive: null,
      link_volume_control: null,
      link_mute_control: null,
      labels: null,
    },
    CoreAudio: {
      type: "CoreAudio",
      channels: 2,
      format: null,
      device: null,
      labels: null,
    },
    PipeWire: {
      type: "PipeWire",
      channels: 2,
      node_name: null,
      node_description: null,
      node_group_name: null,
      autoconnect_to: null,
      labels: null,
    },
    Wasapi: {
      type: "Wasapi",
      channels: 2,
      format: null,
      device: null,
      exclusive: null,
      polling: null,
      loopback: false,
      labels: null,
    },
    Asio: {
      type: "Asio",
      channels: 2,
      format: null,
      device: "enter device name...",
      labels: null,
    },
    Stdin: {
      type: "Stdin",
      channels: 2,
      format: "S32_LE",
      extra_samples: null,
      skip_bytes: null,
      read_bytes: null,
      labels: null,
    },
    RawFile: {
      type: "RawFile",
      channels: 2,
      format: "S32_LE",
      filename: "capture.raw",
      extra_samples: null,
      skip_bytes: null,
      read_bytes: null,
      labels: null,
    },
    WavFile: {
      type: "WavFile",
      filename: "capture.wav",
      extra_samples: null,
      labels: null,
    },
    SignalGenerator: {
      type: "SignalGenerator",
      channels: 2,
      signal: {
        type: "Sine",
        freq: 1000,
        level: -12,
      },
      labels: null,
    },
  }

  const { capture, onChange, errors, supported_capture_types } = props
  const defaultCaptureTypes = Object.keys(defaults) as CaptureType[]
  const captureTypes = supported_capture_types
    ? defaultCaptureTypes.filter((type) => supported_capture_types.includes(type))
    : defaultCaptureTypes
  if (!captureTypes.includes(props.capture.type)) {
    // The selected type isn't available, change to one that is
    props.onChange((devices) => (devices.capture = defaults[captureTypes[0]]))
  }

  useEffect(() => {
    getCaptureDeviceChannelCount(capture).then((nbr) => setChannels(nbr))
  }, [capture])

  useEffect(() => {
    if ((capture.type === "WavFile" || capture.type === "RawFile") && props.audiofilesSupported) {
      loadFiles("audiofile")
        .then(setAvailableCaptureFiles)
        .catch(() => {})
    }
  }, [capture.type, props.audiofilesSupported])

  if (props.hide_capture_device) return null

  const toggleExpanded = () => {
    setExpanded(!expanded)
  }

  const updateChannelLabel = (channel: number, label: string | null) => {
    let existing = capture.labels
    if (existing === null) {
      existing = []
    }
    while (existing.length <= channel) {
      existing.push(null)
    }
    existing[channel] = label
    onChange((devices) => (devices.capture.labels = existing))
  }

  const updateChannelLabels = (labels: (string | null)[] | null) => {
    const channels = "channels" in props.capture ? props.capture.channels : 2
    if (labels !== null && labels.length > channels) {
      labels = labels.slice(0, channels)
    }
    onChange((devices) => (devices.capture.labels = labels))
  }

  const fetchCaptureCapabilities = () => {
    if (!("device" in capture) || capture.device === null || capture.device === "") {
      return
    }
    setDeviceCapabilitiesError(null)
    fetch("/api/capturedevicecapabilities/" + capture.type + "?device=" + encodeURIComponent(capture.device))
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text()
          throw new Error(message || "Failed to load capture device capabilities")
        }
        return response.json()
      })
      .then((capabilities) => setDeviceCapabilities(capabilities))
      .catch((error: Error) => {
        setDeviceCapabilities(null)
        setDeviceCapabilitiesError(error.message)
      })
    setCapabilitiesPopupState(true)
  }

  const makeDropdown = () => {
    return (
      <div>
        {Range(0, channels).map((row) => (
          <OptionalTextOption
            key={row}
            value={capture.labels && capture.labels.length > row ? capture.labels[row] : null}
            error={errors.messageFor("labels")}
            desc={row.toString()}
            tooltip={"Label for channel " + row}
            onChange={(new_label) => updateChannelLabel(row, new_label)}
          />
        ))}
      </div>
    )
  }

  return (
    <Box title="Capture device">
      <KeyValueSelectPopup
        key="capture select popup"
        showItemKey={true}
        open={popupState}
        header="Select capture device"
        items={availableDevices}
        onClose={() => setPopupState(false)}
        onSelect={(device) =>
          onChange((devices) => {
            if (
              devices.capture.type === "Alsa" ||
              devices.capture.type === "Asio" ||
              devices.capture.type === "Wasapi" ||
              devices.capture.type === "CoreAudio"
            ) {
              devices.capture.device = device
            }
          })
        }
      />
      <DeviceCapabilitiesPopup
        open={capabilitiesPopupState}
        header="Capture device capabilities"
        backend={capture.type}
        deviceName={"device" in capture ? capture.device : null}
        capabilities={deviceCapabilities}
        fetchError={deviceCapabilitiesError}
        samplerate={getEffectiveCaptureSamplerate(props.devices)}
        samplerateDescription={getCaptureSamplerateDescription(props.devices)}
        channels={"channels" in capture ? capture.channels : 2}
        format={"format" in capture ? (capture.format ?? null) : null}
        onClose={() => setCapabilitiesPopupState(false)}
        onApply={(newChannels, format) =>
          onChange((devices) => {
            if ("channels" in devices.capture) {
              devices.capture.channels = newChannels
            }
            const capture = devices.capture
            if (capture.type === "Alsa") {
              capture.format = format as AlsaFormat | null
            } else if (capture.type === "Asio") {
              capture.format = format as AsioFormat | null
            } else if (capture.type === "CoreAudio") {
              capture.format = format as CoreAudioFormat | null
            } else if (capture.type === "Wasapi") {
              capture.format = format as WasapiFormat | null
            } else if (format !== null && (capture.type === "Stdin" || capture.type === "RawFile")) {
              capture.format = format as BinaryFormat
            }
          })
        }
      />
      <ErrorMessage message={errors.rootMessage()} />
      <EnumOption
        value={capture.type}
        error={errors.messageFor("type")}
        options={captureTypes}
        desc="type"
        tooltip="Audio backend for capture"
        onChange={(captureType) => onChange((devices) => (devices.capture = defaults[captureType]))}
      />
      {capture.type !== "WavFile" && (
        <IntOption
          value={capture.channels}
          error={errors.messageFor("channels")}
          desc="channels"
          tooltip="Number of channels"
          withControls={true}
          min={1}
          onChange={(channels) =>
            onChange((devices) => {
              if ("channels" in devices.capture) {
                devices.capture.channels = channels
              }
            })
          }
        />
      )}
      {(capture.type === "RawFile" ||
        capture.type === "Stdin" ||
        capture.type === "CoreAudio" ||
        capture.type === "Alsa" ||
        capture.type === "Asio" ||
        capture.type === "Wasapi") && (
        <EnumOption
          value={capture.format}
          error={errors.messageFor("format")}
          options={getFormatOptions(capture.type)}
          desc="sampleformat"
          tooltip="Sample format"
          onChange={(format) =>
            onChange((devices) => {
              const capture = devices.capture
              if (capture.type === "Alsa") {
                capture.format = format as AlsaFormat | null
              } else if (capture.type === "Asio") {
                capture.format = format as AsioFormat | null
              } else if (capture.type === "CoreAudio") {
                capture.format = format as CoreAudioFormat | null
              } else if (capture.type === "Wasapi") {
                capture.format = format as WasapiFormat | null
              } else if (capture.type === "Stdin" || capture.type === "RawFile") {
                capture.format = format as BinaryFormat
              }
            })
          }
        />
      )}
      {capture.type === "Asio" && (
        <DeviceOption
          value={capture.device}
          error={errors.messageFor("device")}
          desc="device"
          onChange={(device) =>
            onChange((devices) => {
              if (devices.capture.type === "Asio") {
                devices.capture.device = device
              }
            })
          }
          onButtonClick={() => {
            fetch("/api/capturedevices/" + capture.type)
              .then((devices) => devices.json())
              .then((names) => setAvailableDevices(names))
            setPopupState(true)
          }}
          extraButtons={
            <MdiButton
              icon={mdiTune}
              tooltip="Inspect device capabilities"
              onClick={fetchCaptureCapabilities}
              className="setting-button"
              buttonSize="small"
            />
          }
        />
      )}
      {capture.type === "Alsa" && (
        <>
          <DeviceOption
            value={capture.device}
            error={errors.messageFor("device")}
            desc="device"
            onChange={(device) =>
              onChange((devices) => {
                if (devices.capture.type === "Alsa") {
                  devices.capture.device = device
                }
              })
            }
            onButtonClick={() => {
              fetch("/api/capturedevices/" + capture.type)
                .then((devices) => devices.json())
                .then((names) => setAvailableDevices(names))
              setPopupState(true)
            }}
            extraButtons={
              <MdiButton
                icon={mdiTune}
                tooltip="Inspect device capabilities"
                onClick={fetchCaptureCapabilities}
                className="setting-button"
                buttonSize="small"
              />
            }
          />
          <OptionalTextOption
            value={capture.link_volume_control}
            error={errors.messageFor("link_volume_control")}
            desc="link_volume_control"
            tooltip="Name of volume control to link with CamillaDSP main volume"
            onChange={(link_volume_control) =>
              onChange((devices) => {
                if (devices.capture.type === "Alsa") {
                  devices.capture.link_volume_control = link_volume_control
                }
              })
            }
          />
          <OptionalTextOption
            value={capture.link_mute_control}
            error={errors.messageFor("link_mute_control")}
            desc="link_mute_control"
            tooltip="Name of mute control to link with CamillaDSP main mute"
            onChange={(link_mute_control) =>
              onChange((devices) => {
                if (devices.capture.type === "Alsa") {
                  devices.capture.link_mute_control = link_mute_control
                }
              })
            }
          />
          <OptionalBoolOption
            value={capture.stop_on_inactive}
            error={errors.messageFor("stop_on_inactive")}
            desc="stop_on_inactive"
            tooltip="Stop if gadget or loopback capture device becomes inactive"
            onChange={(stop_on_inactive) =>
              onChange((devices) => {
                if (devices.capture.type === "Alsa") {
                  devices.capture.stop_on_inactive = stop_on_inactive
                }
              })
            }
          />
        </>
      )}
      {(capture.type === "CoreAudio" || capture.type === "Wasapi") && (
        <OptionalDeviceOption
          value={capture.device}
          error={errors.messageFor("device")}
          desc="device"
          onChange={(device) =>
            onChange((devices) => {
              if (devices.capture.type === "CoreAudio" || devices.capture.type === "Wasapi") {
                devices.capture.device = device
              }
            })
          }
          onButtonClick={() => {
            fetch("/api/capturedevices/" + capture.type)
              .then((devices) => devices.json())
              .then((names) => setAvailableDevices(names))
            setPopupState(true)
          }}
          extraButtons={
            <MdiButton
              icon={mdiTune}
              tooltip="Inspect device capabilities"
              onClick={fetchCaptureCapabilities}
              className="setting-button"
              buttonSize="small"
              enabled={capture.device !== null && capture.device !== ""}
            />
          }
        />
      )}
      {capture.type === "Wasapi" && (
        <>
          <OptionalBoolOption
            value={capture.exclusive}
            error={errors.messageFor("exclusive")}
            desc="exclusive"
            tooltip="Use exclusive mode"
            onChange={(exclusive) =>
              onChange((devices) => {
                if (devices.capture.type === "Wasapi") {
                  devices.capture.exclusive = exclusive
                }
              })
            }
          />
          <OptionalBoolOption
            value={capture.polling}
            error={errors.messageFor("polling")}
            desc="polling"
            tooltip="Use polling instead of event driven mode"
            onChange={(polling) =>
              onChange((devices) => {
                if (devices.capture.type === "Wasapi") {
                  devices.capture.polling = polling
                }
              })
            }
          />
          <OptionalBoolOption
            value={capture.loopback}
            error={errors.messageFor("loopback")}
            desc="loopback"
            tooltip="Use loopback capture mode to capture from a playback device"
            onChange={(loopback) =>
              onChange((devices) => {
                if (devices.capture.type === "Wasapi") {
                  devices.capture.loopback = loopback
                }
              })
            }
          />
        </>
      )}
      {(capture.type === "RawFile" || capture.type === "WavFile") && (
        <>
          <TextOption
            value={capture.filename}
            error={errors.messageFor("filename")}
            desc="filename"
            tooltip="Filename including path"
            icon={
              props.audiofilesSupported
                ? { path: mdiFileSearch, tooltip: "Pick a file", onClick: () => setCaptureFilePickerOpen(true) }
                : undefined
            }
            onChange={(filename) => {
              if (!props.allowAbsolutePaths && (filename.includes("/") || filename.includes("\\"))) return
              onChange((devices) => {
                if (devices.capture.type === "RawFile" || devices.capture.type === "WavFile")
                  devices.capture.filename = filename
              })
            }}
          />
          {props.audiofilesSupported && (
            <FileSelectPopup
              open={captureFilePickerOpen}
              header={<span style={{ margin: "5px", display: "block" }}>Select a file</span>}
              files={availableCaptureFiles.filter((f) =>
                capture.type === "WavFile"
                  ? f.name.toLowerCase().endsWith(".wav")
                  : !f.name.toLowerCase().endsWith(".wav"),
              )}
              onClose={() => setCaptureFilePickerOpen(false)}
              onSelect={(filename) =>
                onChange((devices) => {
                  if (devices.capture.type === "RawFile" || devices.capture.type === "WavFile")
                    devices.capture.filename = filename
                })
              }
            />
          )}
        </>
      )}
      {(capture.type === "RawFile" || capture.type === "Stdin" || capture.type === "WavFile") && (
        <OptionalIntOption
          value={capture.extra_samples}
          error={errors.messageFor("extra_samples")}
          desc="extra_samples"
          tooltip="Number of extra samples to insert after end of file"
          onChange={(extra_samples) =>
            onChange((devices) => {
              if (
                devices.capture.type === "RawFile" ||
                devices.capture.type === "Stdin" ||
                devices.capture.type === "WavFile"
              ) {
                devices.capture.extra_samples = extra_samples
              }
            })
          }
        />
      )}
      {(capture.type === "RawFile" || capture.type === "Stdin") && (
        <>
          <OptionalIntOption
            value={capture.skip_bytes}
            error={errors.messageFor("skip_bytes")}
            desc="skip_bytes"
            tooltip="Number of bytes to skip at beginning of file"
            onChange={(skip_bytes) =>
              onChange((devices) => {
                if (devices.capture.type === "RawFile" || devices.capture.type === "Stdin") {
                  devices.capture.skip_bytes = skip_bytes
                }
              })
            }
          />
          <OptionalIntOption
            value={capture.read_bytes}
            error={errors.messageFor("read_bytes")}
            desc="read_bytes"
            tooltip="Read up to this number of bytes"
            onChange={(read_bytes) =>
              onChange((devices) => {
                if (devices.capture.type === "RawFile" || devices.capture.type === "Stdin") {
                  devices.capture.read_bytes = read_bytes
                }
              })
            }
          />
        </>
      )}
      {capture.type === "PipeWire" && (
        <>
          <OptionalTextOption
            value={capture.node_name}
            error={errors.messageFor("node_name")}
            desc="node_name"
            tooltip="Name of node"
            onChange={(node_name) =>
              onChange((devices) => {
                if (devices.capture.type === "PipeWire") {
                  devices.capture.node_name = node_name
                }
              })
            }
          />
          <OptionalTextOption
            value={capture.node_description}
            error={errors.messageFor("node_description")}
            desc="node_description"
            tooltip="Description of node"
            onChange={(node_description) =>
              onChange((devices) => {
                if (devices.capture.type === "PipeWire") {
                  devices.capture.node_description = node_description
                }
              })
            }
          />
          <OptionalTextOption
            value={capture.node_group_name}
            error={errors.messageFor("node_group_name")}
            desc="node_group_name"
            tooltip="Name of node group"
            onChange={(node_group_name) =>
              onChange((devices) => {
                if (devices.capture.type === "PipeWire") {
                  devices.capture.node_group_name = node_group_name
                }
              })
            }
          />
          <OptionalTextOption
            value={capture.autoconnect_to}
            error={errors.messageFor("autoconnect_to")}
            desc="autoconnect_to"
            tooltip="Name of node to autoconnect to"
            onChange={(autoconnect_to) =>
              onChange((devices) => {
                if (devices.capture.type === "PipeWire") {
                  devices.capture.autoconnect_to = autoconnect_to
                }
              })
            }
          />
        </>
      )}
      {capture.type === "SignalGenerator" && (
        <>
          <EnumOption
            value={capture.signal.type}
            error={errors.messageFor("signal.type")}
            options={Signals}
            desc="type"
            tooltip="Signal type"
            onChange={(signal) =>
              onChange((devices) => {
                if (devices.capture.type === "SignalGenerator") {
                  devices.capture.signal.type = signal
                }
              })
            }
          />
          {(capture.signal.type === "Sine" || capture.signal.type === "Square") && (
            <FloatOption
              value={capture.signal.freq}
              error={errors.messageFor("signal.freq")}
              desc="freq"
              tooltip="Signal frequency in Hz"
              onChange={(freq) =>
                onChange((devices) => {
                  if (
                    devices.capture.type === "SignalGenerator" &&
                    (devices.capture.signal.type === "Sine" || devices.capture.signal.type === "Square")
                  ) {
                    devices.capture.signal.freq = freq
                  }
                })
              }
            />
          )}
          <FloatOption
            value={capture.signal.level}
            error={errors.messageFor("signal.level")}
            desc="level"
            tooltip="Signal level in dB"
            onChange={(level) =>
              onChange((devices) => {
                if (devices.capture.type === "SignalGenerator") {
                  devices.capture.signal.level = level
                }
              })
            }
          />
        </>
      )}
      <LabelListOption
        value={capture.labels ? capture.labels.map((lab) => (lab ? lab : "")).join(",") : ""}
        error={errors.messageFor("labels")}
        desc="labels"
        onChange={updateChannelLabels}
        onButtonClick={toggleExpanded}
      />
      {expanded && makeDropdown()}
    </Box>
  )
}

function PlaybackOptions(props: {
  hide_playback_device: boolean
  supported_playback_types?: PlaybackType[]
  devices: Devices
  playback: PlaybackDevice
  errors: Errors
  onChange: (update: Update<Devices>) => void
  audiofilesSupported?: boolean
  allowAbsolutePaths?: boolean
}) {
  const [popupState, setPopupState] = useState(false)
  const [availableDevices, setAvailableDevices] = useState([])
  const [capabilitiesPopupState, setCapabilitiesPopupState] = useState(false)
  const [deviceCapabilities, setDeviceCapabilities] = useState<DeviceCapabilities | null>(null)
  const [deviceCapabilitiesError, setDeviceCapabilitiesError] = useState<string | null>(null)
  const [availableAudioFiles, setAvailableAudioFiles] = useState<FileInfo[]>([])
  useEffect(() => {
    if (props.playback.type === "File" && props.audiofilesSupported) {
      loadFiles("audiofile")
        .then(setAvailableAudioFiles)
        .catch(() => {})
    }
  }, [props.playback.type, props.audiofilesSupported])
  if (props.hide_playback_device) return null
  const defaults: { [type: string]: PlaybackDevice } = {
    Alsa: { type: "Alsa", channels: 2, format: "S32_LE", device: "hw:0" },
    CoreAudio: {
      type: "CoreAudio",
      channels: 2,
      format: null,
      device: null,
      exclusive: null,
    },
    PipeWire: {
      type: "PipeWire",
      channels: 2,
      node_name: null,
      node_description: null,
      node_group_name: null,
      autoconnect_to: null,
    },
    Wasapi: {
      type: "Wasapi",
      channels: 2,
      format: null,
      device: null,
      exclusive: null,
      polling: null,
    },
    Asio: {
      type: "Asio",
      channels: 2,
      format: null,
      device: "enter device name...",
    },
    Stdout: { type: "Stdout", channels: 2, format: "S32_LE", wav_header: null },
    File: {
      type: "File",
      channels: 2,
      format: "S32_LE",
      filename: "output.raw",
      wav_header: false,
      use_rf64: null,
    },
  }
  const { onChange, playback, errors, supported_playback_types } = props
  const defaultPlaybackTypes = Object.keys(defaults) as PlaybackType[]
  const playbackDeviceTypes = supported_playback_types
    ? defaultPlaybackTypes.filter((type) => supported_playback_types.includes(type))
    : defaultPlaybackTypes
  if (!playbackDeviceTypes.includes(props.playback.type)) {
    // The selected type isn't available, change to one that is
    props.onChange((devices) => (devices.playback = defaults[playbackDeviceTypes[0]]))
  }

  const fetchPlaybackCapabilities = () => {
    if (!("device" in playback) || playback.device === null || playback.device === "") {
      return
    }
    setDeviceCapabilitiesError(null)
    fetch("/api/playbackdevicecapabilities/" + playback.type + "?device=" + encodeURIComponent(playback.device))
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text()
          throw new Error(message || "Failed to load playback device capabilities")
        }
        return response.json()
      })
      .then((capabilities) => setDeviceCapabilities(capabilities))
      .catch((error: Error) => {
        setDeviceCapabilities(null)
        setDeviceCapabilitiesError(error.message)
      })
    setCapabilitiesPopupState(true)
  }

  return (
    <Box title="Playback device">
      <KeyValueSelectPopup
        key="playback select popup"
        showItemKey={true}
        open={popupState}
        header="Select playback device"
        items={availableDevices}
        onClose={() => setPopupState(false)}
        onSelect={(device) =>
          onChange((devices) => {
            if (
              devices.playback.type === "Alsa" ||
              devices.playback.type === "Asio" ||
              devices.playback.type === "Wasapi" ||
              devices.playback.type === "CoreAudio"
            ) {
              devices.playback.device = device
            }
          })
        }
      />
      <DeviceCapabilitiesPopup
        open={capabilitiesPopupState}
        header="Playback device capabilities"
        backend={playback.type}
        deviceName={"device" in playback ? playback.device : null}
        capabilities={deviceCapabilities}
        fetchError={deviceCapabilitiesError}
        samplerate={getEffectivePlaybackSamplerate(props.devices)}
        samplerateDescription={getPlaybackSamplerateDescription(props.devices)}
        channels={playback.channels}
        format={"format" in playback ? (playback.format ?? null) : null}
        onClose={() => setCapabilitiesPopupState(false)}
        onApply={(newChannels, format) =>
          onChange((devices) => {
            devices.playback.channels = newChannels
            const playback = devices.playback
            if (playback.type === "Alsa") {
              playback.format = format as AlsaFormat | null
            } else if (playback.type === "Asio") {
              playback.format = format as AsioFormat | null
            } else if (playback.type === "CoreAudio") {
              playback.format = format as CoreAudioFormat | null
            } else if (playback.type === "Wasapi") {
              playback.format = format as WasapiFormat | null
            } else if (format !== null && (playback.type === "File" || playback.type === "Stdout")) {
              playback.format = format as BinaryFormat
            }
          })
        }
      />
      <ErrorMessage message={errors.rootMessage()} />
      <EnumOption
        value={props.playback.type}
        error={errors.messageFor("type")}
        options={playbackDeviceTypes}
        tooltip="Audio backend for playback"
        desc="type"
        onChange={(playbackType) => props.onChange((devices) => (devices.playback = defaults[playbackType]))}
      />
      <IntOption
        value={playback.channels}
        error={errors.messageFor("channels")}
        desc="channels"
        tooltip="Number of channels"
        withControls={true}
        min={1}
        onChange={(channels) => onChange((devices) => (devices.playback.channels = channels))}
      />
      {(playback.type === "File" ||
        playback.type === "Stdout" ||
        playback.type === "CoreAudio" ||
        playback.type === "Alsa" ||
        playback.type === "Asio" ||
        playback.type === "Wasapi") && (
        <EnumOption
          value={playback.format}
          error={errors.messageFor("format")}
          options={getFormatOptions(playback.type)}
          desc="sampleformat"
          tooltip="Sample format"
          onChange={(format) =>
            onChange((devices) => {
              const playback = devices.playback
              if (playback.type === "Alsa") {
                playback.format = format as AlsaFormat | null
              } else if (playback.type === "Asio") {
                playback.format = format as AsioFormat | null
              } else if (playback.type === "CoreAudio") {
                playback.format = format as CoreAudioFormat | null
              } else if (playback.type === "Wasapi") {
                playback.format = format as WasapiFormat | null
              } else if (playback.type === "File" || playback.type === "Stdout") {
                playback.format = format as BinaryFormat
              }
            })
          }
        />
      )}
      {playback.type === "Asio" && (
        <DeviceOption
          value={playback.device}
          desc="device"
          onChange={(device) =>
            onChange((devices) => {
              if (devices.playback.type === "Asio") {
                devices.playback.device = device
              }
            })
          }
          error={errors.messageFor("device")}
          onButtonClick={() => {
            fetch("/api/playbackdevices/" + playback.type)
              .then((devices) => devices.json())
              .then((names) => setAvailableDevices(names))
            setPopupState(true)
          }}
          extraButtons={
            <MdiButton
              icon={mdiTune}
              tooltip="Inspect device capabilities"
              onClick={fetchPlaybackCapabilities}
              className="setting-button"
              buttonSize="small"
            />
          }
        />
      )}
      {playback.type === "Alsa" && (
        <DeviceOption
          value={playback.device}
          desc="device"
          onChange={(device) =>
            onChange((devices) => {
              if (devices.playback.type === "Alsa") {
                devices.playback.device = device
              }
            })
          }
          error={errors.messageFor("device")}
          onButtonClick={() => {
            fetch("/api/playbackdevices/" + playback.type)
              .then((devices) => devices.json())
              .then((names) => setAvailableDevices(names))
            setPopupState(true)
          }}
          extraButtons={
            <MdiButton
              icon={mdiTune}
              tooltip="Inspect device capabilities"
              onClick={fetchPlaybackCapabilities}
              className="setting-button"
              buttonSize="small"
            />
          }
        />
      )}
      {(playback.type === "CoreAudio" || playback.type === "Wasapi") && (
        <OptionalDeviceOption
          value={playback.device}
          desc="device"
          onChange={(device) =>
            onChange((devices) => {
              if (devices.playback.type === "CoreAudio" || devices.playback.type === "Wasapi") {
                devices.playback.device = device
              }
            })
          }
          error={errors.messageFor("device")}
          onButtonClick={() => {
            fetch("/api/playbackdevices/" + playback.type)
              .then((devices) => devices.json())
              .then((names) => setAvailableDevices(names))
            setPopupState(true)
          }}
          extraButtons={
            <MdiButton
              icon={mdiTune}
              tooltip="Inspect device capabilities"
              onClick={fetchPlaybackCapabilities}
              className="setting-button"
              buttonSize="small"
              enabled={playback.device !== null && playback.device !== ""}
            />
          }
        />
      )}
      {(playback.type === "Wasapi" || playback.type === "CoreAudio") && (
        <OptionalBoolOption
          value={playback.exclusive}
          error={errors.messageFor("device")}
          desc="exclusive"
          tooltip="Use exclusive mode"
          onChange={(exclusive) =>
            onChange((devices) => {
              if (devices.playback.type === "Wasapi" || devices.playback.type === "CoreAudio") {
                devices.playback.exclusive = exclusive
              }
            })
          }
        />
      )}
      {playback.type === "Wasapi" && (
        <OptionalBoolOption
          value={playback.polling}
          error={errors.messageFor("polling")}
          desc="polling"
          tooltip="Use polling instead of event driven mode"
          onChange={(polling) =>
            onChange((devices) => {
              if (devices.playback.type === "Wasapi") {
                devices.playback.polling = polling
              }
            })
          }
        />
      )}
      {playback.type === "File" && (
        <TextOption
          value={playback.filename}
          error={errors.messageFor("filename")}
          warning={
            availableAudioFiles.some((f) => f.name === playback.filename)
              ? "This file already exists and will be overwritten"
              : undefined
          }
          desc="filename"
          tooltip="Filename including path"
          onChange={(filename) => {
            if (!props.allowAbsolutePaths && (filename.includes("/") || filename.includes("\\"))) return
            onChange((devices) => {
              if (devices.playback.type === "File") {
                devices.playback.filename = filename
              }
            })
          }}
        />
      )}
      {(playback.type === "File" || playback.type === "Stdout") && (
        <OptionalBoolOption
          value={playback.wav_header}
          error={errors.messageFor("wav_header")}
          desc="wav_header"
          tooltip="Write output as a wav file"
          onChange={(wav_header) =>
            onChange((devices) => {
              if (devices.playback.type === "File" || devices.playback.type === "Stdout") {
                devices.playback.wav_header = wav_header
              }
            })
          }
        />
      )}
      {playback.type === "File" && (
        <OptionalBoolOption
          value={playback.use_rf64}
          error={errors.messageFor("use_rf64")}
          desc="use_rf64"
          tooltip="Write an RF64 header, to allow files larger than 4 GB.<br>Requires wav_header and a seekable file"
          onChange={(use_rf64) =>
            onChange((devices) => {
              if (devices.playback.type === "File") {
                devices.playback.use_rf64 = use_rf64
              }
            })
          }
        />
      )}
      {playback.type === "PipeWire" && (
        <>
          <OptionalTextOption
            value={playback.node_name}
            error={errors.messageFor("node_name")}
            desc="node_name"
            tooltip="Name of node"
            onChange={(node_name) =>
              onChange((devices) => {
                if (devices.playback.type === "PipeWire") {
                  devices.playback.node_name = node_name
                }
              })
            }
          />
          <OptionalTextOption
            value={playback.node_description}
            error={errors.messageFor("node_description")}
            desc="node_description"
            tooltip="Description of node"
            onChange={(node_description) =>
              onChange((devices) => {
                if (devices.playback.type === "PipeWire") {
                  devices.playback.node_description = node_description
                }
              })
            }
          />
          <OptionalTextOption
            value={playback.node_group_name}
            error={errors.messageFor("node_group_name")}
            desc="node_group_name"
            tooltip="Name of node group"
            onChange={(node_group_name) =>
              onChange((devices) => {
                if (devices.playback.type === "PipeWire") {
                  devices.playback.node_group_name = node_group_name
                }
              })
            }
          />
          <OptionalTextOption
            value={playback.autoconnect_to}
            error={errors.messageFor("autoconnect_to")}
            desc="autoconnect_to"
            tooltip="Name of node to autoconnect to"
            onChange={(autoconnect_to) =>
              onChange((devices) => {
                if (devices.playback.type === "PipeWire") {
                  devices.playback.autoconnect_to = autoconnect_to
                }
              })
            }
          />
        </>
      )}
    </Box>
  )
}

function DeviceOption(props: {
  value: string
  error?: string
  desc: string
  onChange: (device: string) => void
  onButtonClick: () => void
  extraButtons?: React.ReactNode
}) {
  return (
    <div className="setting" data-tooltip-html="Name of device">
      <label htmlFor={props.desc} className="setting-label">
        {props.desc}
      </label>
      <div className="setting-input device-option-row">
        <InputWithIcon icon={mdiMagnify} tooltip="Pick a device" onClick={props.onButtonClick}>
          <TextInput value={props.value} tooltip="Name of device" onChange={props.onChange} />
        </InputWithIcon>
        {props.extraButtons && <div className="device-option-buttons">{props.extraButtons}</div>}
      </div>
      <ErrorMessage message={props.error} />
    </div>
  )
}

function OptionalDeviceOption(props: {
  value: string | null
  error?: string
  desc: string
  onChange: (device: string | null) => void
  onButtonClick: () => void
  extraButtons?: React.ReactNode
}) {
  return (
    <div className="setting" data-tooltip-html="Name of device">
      <label htmlFor={props.desc} className="setting-label">
        {props.desc}
      </label>
      <div className="setting-input device-option-row">
        <InputWithIcon icon={mdiMagnify} tooltip="Pick a device" onClick={props.onButtonClick}>
          <OptionalTextInput value={props.value} tooltip="Name of device" onChange={props.onChange} />
        </InputWithIcon>
        {props.extraButtons && <div className="device-option-buttons">{props.extraButtons}</div>}
      </div>
      <ErrorMessage message={props.error} />
    </div>
  )
}
