import React, {useEffect, useState} from "react"
import "./index.css"
import {
  AsyncPolyInterpolations,
  AsyncSincInterpolations,
  AsyncSincProfile,
  AsyncSincProfiles,
  AsyncSincWindows,
  CaptureDevice,
  Config,
  defaultResampler,
  defaultSincResampler,
  Devices,
  Formats,
  PlaybackDevice,
  Resampler,
  ResamplerType,
  ResamplerTypes
} from "./camilladsp/config"
import {CaptureType, GuiConfig, PlaybackType} from "./guiconfig"
import {
  add_default_option,
  Box,
  default_to_null,
  EnumInput,
  EnumOption,
  ErrorBoundary,
  ErrorMessage,
  IntInput,
  IntOption,
  KeyValueSelectPopup,
  LabelListOption,
  MdiButton,
  null_to_default,
  OptionalBoolOption,
  OptionalEnumOption,
  OptionalFloatOption,
  OptionalIntInput,
  OptionalIntOption,
  OptionalTextInput,
  OptionalTextOption,
  TextInput,
  TextOption,
} from "./utilities/ui-components"
import {mdiMagnify} from '@mdi/js'
import { Range } from "immutable"

import {Errors} from "./utilities/errors"
import {Update} from "./utilities/common"

// TODO add volume_ramp_time
// TODO redo resampler config

export function DevicesTab(props: {
  guiConfig: GuiConfig
  devices: Devices
  errors: Errors
  updateConfig: (update: Update<Config>) => void
}) {
  const updateDevices = (update: Update<Devices>) => props.updateConfig(config => update(config.devices))
  const {guiConfig, devices, errors} = props
  const [availableBackends, setAvailableBackends] = useState([
    guiConfig.supported_playback_types,
    guiConfig.supported_capture_types
  ])
  useEffect(() => {
    fetch("/api/backends")
      .then(response => {
        if (response.ok)
          return response.json()
            .then(backends => setAvailableBackends(backends))
      })
  }, []);
  return <ErrorBoundary errorMessage={errors.asText()}>
    <div className="tabcontainer">
      <div className="tabpanel">
        <ErrorMessage message={errors.rootMessage()}/>
        <Samplerate
            hide_capture_samplerate={guiConfig.hide_capture_samplerate}
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <BufferOptions
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <SilenceOptions
            hide_silence={guiConfig.hide_silence}
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <RateAdjustOptions
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <ResamplingOptions
            hide_capture_samplerate={guiConfig.hide_capture_samplerate}
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <RateMonitoringOptions
            hide_rate_monitoring={guiConfig.hide_rate_monitoring}
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <VolumeOptions
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <MultithreadingOptions
            hide_multithreading={guiConfig.hide_multithreading}
            devices={devices}
            errors={errors}
            onChange={updateDevices}/>
        <CaptureOptions
            hide_capture_device={guiConfig.hide_capture_device}
            supported_capture_types={availableBackends[1] as CaptureType[]}
            capture={devices.capture}
            errors={errors.forSubpath('capture')}
            onChange={updateDevices}/>
        <PlaybackOptions
            hide_playback_device={guiConfig.hide_playback_device}
            supported_playback_types={availableBackends[0] as PlaybackType[]}
            playback={devices.playback}
            errors={errors.forSubpath('playback')}
            onChange={updateDevices}
        />
      </div>
      <div className="tabspacer"/>
    </div>
  </ErrorBoundary>
}

function Samplerate(props: {
  hide_capture_samplerate: boolean
  devices: Devices
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_capture_samplerate && props.devices.resampler !== null)
    return null
  return <SamplerateOption
      samplerate={props.devices.samplerate}
      error={props.errors.messageFor('samplerate')}
      desc="samplerate"
      tooltip="Sample rate for processing and output"
      onChange={samplerate => props.onChange(devices => { devices.samplerate = samplerate })}
      extraPadding={true}
  />
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
  const other = 'Other'
  const samplerate = props.samplerate
  const padding = props.extraPadding ? '0 12px' : '0'
  return <div className="setting" data-tooltip-html-={props.tooltip} style={{padding: padding}}>
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <EnumInput
        value={isNonDefaultSamplerate(samplerate) ? other : samplerate.toString()}
        options={defaultSampleRates.map(samplerate => samplerate.toString()).concat([other])}
        desc={props.desc}
        tooltip={props.tooltip}
        style={{width: isNonDefaultSamplerate(samplerate) ? '40%' : '100%'}}
        className="setting-input"
        onChange={value => {
          const parsed = parseInt(value)
          const newSamplerate = isNaN(parsed) ? 0 : parsed
          props.onChange(newSamplerate)
        }}/>
    {isNonDefaultSamplerate(samplerate) &&
    <IntInput
        value={samplerate}
        tooltip={props.tooltip}
        className="setting-input"
        style={{width: '60%'}}
        onChange={samplerate => props.onChange(samplerate)}/>
    }
    <ErrorMessage message={props.error}/>
  </div>
}

function OptionalSamplerateOption(props: {
  samplerate: number | null
  error?: string
  desc: string
  tooltip: string
  onChange: (samplerate: number|null) => void
  extraPadding?: boolean
}) {
  const defaultSampleRates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]
  function isNonDefaultSamplerate(samplerate: number | null): boolean {
    return samplerate !== null && !defaultSampleRates.includes(samplerate)
  }
  const other = 'Other'
  const samplerate = props.samplerate
  const padding = props.extraPadding ? '0 12px' : '0'
  let value: null | string
  if (samplerate === null)
    value = null
  else if (isNonDefaultSamplerate(samplerate))
    value = other
  else
    value = samplerate.toString()
  const options = defaultSampleRates.map(samplerate => samplerate.toString()).concat([other])
  add_default_option(options, "default")
  return <div className="setting" data-tooltip-html={props.tooltip} data-tooltip-id="main-tooltip" style={{padding: padding}}>
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <EnumInput
        value={null_to_default(value, "default")}
        options={options}
        desc={props.desc}
        tooltip={props.tooltip}
        style={{width: isNonDefaultSamplerate(samplerate) ? '40%' : '100%'}}
        className="setting-input"
        onChange={(value: string) => {
          const parsed = default_to_null(value, "default") ? parseInt(value) : null
          const newSamplerate = parsed !== null && isNaN(parsed) ? 0 : parsed
          props.onChange(newSamplerate)
        }}/>
    {isNonDefaultSamplerate(samplerate) &&
    <OptionalIntInput
        value={samplerate}
        tooltip={props.tooltip}
        className="setting-input"
        style={{width: '60%'}}
        onChange={(samplerate: number | null) => props.onChange(samplerate)}/>
    }
    <ErrorMessage message={props.error}/>
  </div>
}

function BufferOptions(props: {
  devices: Devices,
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  return <Box title="Buffers">
    <IntOption
        value={props.devices.chunksize}
        error={props.errors.messageFor('chunksize')}
        desc="chunksize"
        tooltip="Chunksize for the processing"
        onChange={chunksize => props.onChange(devices => devices.chunksize = chunksize)}/>
    <OptionalIntOption
        value={props.devices.queuelimit}
        error={props.errors.messageFor('queuelimit')}
        desc="queuelimit"
        tooltip="Length limit for internal queues"
        onChange={queuelimit => props.onChange(devices => devices.queuelimit = queuelimit)}/>
  </Box>
}

function SilenceOptions(props: {
  hide_silence: boolean
  devices: Devices
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_silence)
    return null
  return <Box title="Silence">
    <OptionalFloatOption
        value={props.devices.silence_threshold}
        error={props.errors.messageFor('silence_threshold')}
        desc="silence_threshold"
        tooltip="Threshold for silence in dB"
        onChange={silenceThreshold => props.onChange(devices => devices.silence_threshold = silenceThreshold)}/>
    <OptionalFloatOption
        value={props.devices.silence_timeout}
        error={props.errors.messageFor('silence_timeout')}
        desc="silence_timeout"
        tooltip="Pause processing after this many seconds of silence"
        onChange={silenceTimeout => props.onChange(devices => devices.silence_timeout = silenceTimeout)}/>
  </Box>
}

function RateAdjustOptions(props: {
  devices: Devices
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  let playbackDeviceIsOneOf = (types: string[]) => types.includes(props.devices.playback.type)
  if (playbackDeviceIsOneOf(["File", "Stdout", "Pulse"]))
    return null
  return <Box title="Rate adjust">
    <OptionalBoolOption
        value={props.devices.enable_rate_adjust}
        error={props.errors.messageFor('enable_rate_adjust')}
        desc="enable_rate_adjust"
        tooltip="Enable rate adjust"
        onChange={enableRateAdjust => props.onChange(devices => devices.enable_rate_adjust = enableRateAdjust)}/>
    <OptionalIntOption
        value={props.devices.adjust_period}
        error={props.errors.messageFor('adjust_period')}
        desc="adjust_period"
        tooltip="Delay in seconds between rate adjustments"
        onChange={adjustPeriod => props.onChange(devices => devices.adjust_period = adjustPeriod)}/>
    <OptionalIntOption
        value={props.devices.target_level}
        error={props.errors.messageFor('target_level')}
        desc="target_level"
        tooltip="Target output buffer fill level for rate adjust"
        onChange={targetLevel => props.onChange(devices => devices.target_level = targetLevel)}/>
  </Box>
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
  const {devices, errors} = props
  return <Box title="Resampling">
    <OptionalEnumOption
        value={devices.resampler? devices.resampler.type : null}
        error={errors.messageFor('resampler.type')}
        options={ResamplerTypes}
        desc="resampler_type"
        tooltip="Resampler type"
        placeholder="none"
        onChange={resamplerType => props.onChange(devices => devices.resampler = changeResamplerType(resamplerType))}/>
    {devices.resampler && devices.resampler.type === 'AsyncSinc' &&
    <EnumOption
        // @ts-ignore
        value={devices.resampler.hasOwnProperty("profile") ? devices.resampler.profile : "Free"}
        error={errors.messageFor('resampler.profile')}
        options={AsyncSincProfiles}
        desc="profile"
        tooltip="AsyncSinc resampler profile"
        onChange={profile => props.onChange(devices => devices.resampler = changeResamplerProfile(profile))}/>
    }
    {devices.resampler && devices.resampler.type === 'AsyncSinc' && !devices.resampler.hasOwnProperty("profile") &&
    <>
      <EnumOption
        // @ts-ignore
        value={devices.resampler.interpolation}
        error={errors.messageFor('interpolation')}
        options={AsyncSincInterpolations}
        desc="interpolation"
        tooltip="Interpolation order"
        // @ts-ignore
        onChange={interp => props.onChange(devices => devices.resampler.interpolation = interp)}/>
      <IntOption
        // @ts-ignore
        value={devices.resampler.sinc_len}
        error={errors.messageFor('resampler', 'sinc_len')}
        desc="sinc_len"
        tooltip="Length of sinc interpolation filter"
        // @ts-ignore
        onChange={len => props.onChange(devices => devices.resampler.sinc_len = len)}/>
      <IntOption
        // @ts-ignore
        value={devices.resampler.oversampling_factor}
        error={errors.messageFor('resampler', 'oversampling_factor')}
        desc="oversampling_factor"
        tooltip="Oversampling factor"
        // @ts-ignore
        onChange={factor => props.onChange(devices => devices.resampler.oversampling_factor = factor)}/>
      <OptionalFloatOption
        // @ts-ignore
        value={devices.resampler.f_cutoff}
        error={errors.messageFor('f_cutoff')}
        desc="f_cutoff"
        tooltip="Relative cutoff frequency of interpolation filter"
        // @ts-ignore
        onChange={cutoff => props.onChange(devices => devices.resampler.f_cutoff = cutoff)}/>
      <EnumOption
        // @ts-ignore
        value={devices.resampler.window}
        error={errors.messageFor('window')}
        options={AsyncSincWindows}
        desc="window"
        tooltip="Window function for interpolation filter"
        // @ts-ignore
        onChange={window => props.onChange(devices => devices.resampler.window = window)}/>
    </>}
    {devices.resampler && devices.resampler.type === 'AsyncPoly' &&
    <EnumOption
      // @ts-ignore
      value={devices.resampler.interpolation}
      error={errors.messageFor('interpolation')}
      options={AsyncPolyInterpolations}
      desc="interpolation"
      tooltip="Interpolation order"
      // @ts-ignore
      onChange={interp => props.onChange(devices => devices.resampler.interpolation = interp)}/> }
    {!props.hide_capture_samplerate && devices.resampler !== null &&
    <OptionalSamplerateOption
        samplerate={devices.capture_samplerate}
        error={errors.messageFor('capture_samplerate')}
        desc="capture_samplerate"
        tooltip="Sample rate for capture device.<br>If different from 'samplerate' then resampling must be enabled"
        onChange={captureSamplerate => props.onChange(devices => devices.capture_samplerate = captureSamplerate)}/>
    }
  </Box>
}

function RateMonitoringOptions(props: {
    hide_rate_monitoring: boolean
    devices: Devices
    errors: Errors
    error?: string
    onChange: (update: Update<Devices>) => void
  }) {
    if (props.hide_rate_monitoring)
        return null
    return <Box title="Capture rate monitoring">
        <OptionalFloatOption
            value={props.devices.rate_measure_interval}
            error={props.errors.messageFor('rate_measure_interval')}
            desc="rate_measure_interval"
            tooltip="Interval for rate measurements, in seconds"
            onChange={rateMeasureInterval => props.onChange(devices => devices.rate_measure_interval = rateMeasureInterval)}/>
        <OptionalBoolOption
            value={props.devices.stop_on_rate_change}
            error={props.errors.messageFor('stop_on_rate_change')}
            desc="stop_on_rate_change"
            tooltip="Stop processing when a sample rate change is detected"
            onChange={stopOnRateChange => props.onChange(devices => devices.stop_on_rate_change = stopOnRateChange)}/>
    </Box>
  }

  function MultithreadingOptions(props: {
    hide_multithreading: boolean
    devices: Devices
    errors: Errors
    error?: string
    onChange: (update: Update<Devices>) => void
  }) {
    if (props.hide_multithreading)
        return null
    return <Box title="Multithreaded processing">
        <OptionalBoolOption
            value={props.devices.multithreaded}
            error={props.errors.messageFor('multithreaded')}
            desc="multithreaded"
            tooltip="Enable multithreaded processing of filters"
            onChange={multithreaded => props.onChange(devices => devices.multithreaded = multithreaded)}/>
        <OptionalIntOption
            value={props.devices.worker_threads}
            error={props.errors.messageFor('worker_threads')}
            desc="worker_threads"
            tooltip="Number of worker threads for filter processing"
            onChange={workerThreads => props.onChange(devices => devices.worker_threads = workerThreads)}/>

    </Box>
  }

  function VolumeOptions(props: {
    devices: Devices
    errors: Errors
    error?: string
    onChange: (update: Update<Devices>) => void
  }) {
    return <Box title="Volume control settings">
        <OptionalFloatOption
            value={props.devices.volume_ramp_time}
            error={props.errors.messageFor('volume_ramp_time')}
            desc="volume_ramp_time"
            tooltip="Ramp time for main volume control, in milliseconds"
            onChange={volumeRampTime => props.onChange(devices => devices.volume_ramp_time = volumeRampTime)}/>
        <OptionalFloatOption
            value={props.devices.volume_limit}
            error={props.errors.messageFor('volume_limit')}
            desc="volume_limit"
            tooltip="Upper limit for main volume control, in dB"
            onChange={volumeLimit => props.onChange(devices => devices.volume_limit = volumeLimit)}/>
    </Box>
  }

function CaptureOptions(props: {
  hide_capture_device: boolean
  supported_capture_types?: CaptureType[]
  capture: CaptureDevice
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  const [popupState, setPopupState] = useState(false)
  const [availableDevices, setAvailableDevices] = useState([])
  let [expanded, setExpanded] = useState(false)
  if (props.hide_capture_device)
    return null
  const defaults: { [type: string]: CaptureDevice } = {
    Alsa: { type: 'Alsa', channels: 2, format: 'S32LE', device: "hw:0", stop_on_inactive: null, link_volume_control: null, link_mute_control: null, labels: null },
    CoreAudio: { type: 'CoreAudio', channels: 2, format: null, device: null, labels: null },
    Pulse: { type: 'Pulse', channels: 2, format: 'S32LE', device: 'something', labels: null },
    Wasapi: { type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: null, exclusive: false, loopback: false, labels: null},
    Jack: { type: 'Jack', channels: 2, device: 'default', labels: null},
    Stdin: { type: 'Stdin', channels: 2, format: 'S32LE', extra_samples: null, skip_bytes: null, read_bytes: null, labels: null },
    RawFile: { type: 'RawFile', channels: 2, format: 'S32LE', filename: '/path/to/file',
      extra_samples: null, skip_bytes: null, read_bytes: null, labels: null },
    WavFile: { type: 'WavFile', filename: '/path/to/file', extra_samples: null, labels: null },
    Bluez: { type: 'Bluez', service: null, dbus_path: 'dbus_path', format: 'S16LE', channels: 2, labels: null}
  }

  const {capture, onChange, errors, supported_capture_types} = props
  const defaultCaptureTypes = Object.keys(defaults) as CaptureType[];
  const captureTypes = supported_capture_types ?
      defaultCaptureTypes.filter(type => supported_capture_types.includes(type))
      : defaultCaptureTypes
  if (!captureTypes.includes(props.capture.type)) {
    // The selected type isn't available, change to one that is
    props.onChange(devices => devices.capture= defaults[captureTypes[0]])
  }


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
    console.log("Update label for channel", channel, label)
    onChange(devices =>
      devices.capture.labels = existing)
  }

  const updateChannelLabels = (labels: (string | null)[] | null) => {
    let channels = "channels" in props.capture ? props.capture.channels : 2
    if (labels !== null && labels.length > channels) {
      labels = labels.slice(0, channels)
    }
    console.log("Update labels to", labels)
    onChange(devices =>
      devices.capture.labels = labels)
  }

  const makeDropdown = () =>
  {
    return <div>
      {Range(0, 2).map(row => (
                <OptionalTextOption value={capture.labels && capture.labels.length > row ? capture.labels[row] : null } 
                error={errors.messageFor('labels')}
                desc={row.toString()}
                tooltip={'Label for channel '+ row}
                onChange={new_label => updateChannelLabel(row, new_label)}/>
            ))}
    </div>
}

  return <Box title="Capture device">
    <KeyValueSelectPopup
          key="capture select popup"
          open={popupState}
          header="Select capture device"
          items={availableDevices}
          onClose={() => setPopupState(false)}
          onSelect={device => onChange(devices => // @ts-ignore
              devices.capture.device = device
          )}
      />
    <ErrorMessage message={errors.rootMessage()}/>
    <EnumOption
        value={capture.type}
        error={errors.messageFor('type')}
        options={captureTypes}
        desc="type"
        tooltip="Audio backend for capture"
        onChange={captureType => onChange(devices => devices.capture = defaults[captureType])}/>
    {(capture.type !== 'WavFile') &&
    <IntOption
        value={capture.channels}
        error={errors.messageFor('channels')}
        desc="channels"
        tooltip="Number of channels"
        withControls={true}
        min={1}
        // @ts-ignore
        onChange={channels => onChange(devices => devices.capture.channels = channels)}/>
    }
    {(capture.type !== 'Jack' && capture.type !== 'CoreAudio' && capture.type !== 'WavFile' && capture.type !== 'Alsa') &&
    <EnumOption
        value={capture.format}
        error={errors.messageFor('format')}
        options={Formats}
        desc="sampleformat"
        tooltip="Sample format"
        onChange={format => onChange(devices => // @ts-ignore
            devices.capture.format = format
        )}/>
    }
    {(capture.type === 'CoreAudio' || capture.type === 'Alsa') &&
    <OptionalEnumOption
        value={capture.format}
        error={errors.messageFor('format')}
        options={Formats}
        desc="sampleformat"
        tooltip="Sample format"
        onChange={format => onChange(devices => // @ts-ignore
            devices.capture.format = format
        )}
        />
    }
    {(capture.type === 'Alsa') &&  <>
      <DeviceOption
        value={capture.device}
        error={errors.messageFor('device')}
        desc="device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}
        onButtonClick={() => {
          fetch("/api/capturedevices/" + capture.type)
            .then(devices => devices.json())
            .then(names => setAvailableDevices(names))
          setPopupState(true)
        }} />
      <OptionalTextOption
          value={capture.link_volume_control}
          error={errors.messageFor('link_volume_control')}
          desc="link_volume_control"
          tooltip="Name of volume control to link with CamillaDSP main volume"
          onChange={link_volume_control => onChange(devices => // @ts-ignore
              devices.capture.link_volume_control = link_volume_control
          )}/>
      <OptionalTextOption
          value={capture.link_mute_control}
          error={errors.messageFor('link_mute_control')}
          desc="link_mute_control"
          tooltip="Name of mute control to link with CamillaDSP main mute"
          onChange={link_mute_control => onChange(devices => // @ts-ignore
              devices.capture.link_mute_control = link_mute_control
          )}/>
      <OptionalBoolOption
            value={capture.stop_on_inactive}
            error={errors.messageFor('stop_on_inactive')}
            desc="stop_on_inactive"
            tooltip="Stop if gadget or loopback capture device becomes inactive"
            onChange={stop_on_inactive => onChange(devices => // @ts-ignore
                devices.capture.stop_on_inactive = stop_on_inactive
            )}/>
      </>
    }
    {(capture.type === 'CoreAudio' || capture.type === 'Wasapi') &&
    <OptionalDeviceOption
        value={capture.device}
        error={errors.messageFor('device')}
        desc="device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}
        onButtonClick={() => {
          fetch("/api/capturedevices/" + capture.type)
            .then(devices => devices.json())
            .then(names => setAvailableDevices(names))
          setPopupState(true)
        }} />
    }
    {(capture.type === 'Pulse') &&
    <TextOption
        value={capture.device}
        error={errors.messageFor('device')}
        desc="device"
        tooltip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}/>
    }
    {(capture.type === 'Wasapi') && <>
        <OptionalBoolOption
            value={capture.exclusive}
            error={errors.messageFor('exclusive')}
            desc="exclusive"
            tooltip="Use exclusive mode"
            onChange={exclusive => onChange(devices => // @ts-ignore
                devices.capture.exclusive = exclusive
            )}/>
        <OptionalBoolOption
            value={capture.loopback}
            error={errors.messageFor('loopback')}
            desc="loopback"
            tooltip="Use loopback capture mode to capture from a playback device"
            onChange={loopback => onChange(devices => // @ts-ignore
                devices.capture.loopback = loopback
            )}/>
        </>
    }
    {(capture.type === 'RawFile' || capture.type === 'WavFile') &&
    <TextOption
        value={capture.filename}
        error={errors.messageFor('filename')}
        desc="filename"
        tooltip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.capture.filename = filename
        )}/>
    }
    {(capture.type === 'RawFile' || capture.type === 'Stdin' || capture.type === 'WavFile') &&
      <OptionalIntOption
          value={capture.extra_samples}
          error={errors.messageFor('extra_samples')}
          desc="extra_samples"
          tooltip="Number of extra samples to insert after end of file"
          onChange={extra_samples => onChange(devices => // @ts-ignore
              devices.capture.extra_samples = extra_samples
          )}/>
      }
      {(capture.type === 'RawFile' || capture.type === 'Stdin') && <>
      <OptionalIntOption
          value={capture.skip_bytes}
          error={errors.messageFor('skip_bytes')}
          desc="skip_bytes"
          tooltip="Number of bytes to skip at beginning of file"
          onChange={skip_bytes => onChange(devices => // @ts-ignore
              devices.capture.skip_bytes = skip_bytes
          )}/>
      <OptionalIntOption
          value={capture.read_bytes}
          error={errors.messageFor('read_bytes')}
          desc="read_bytes"
          tooltip="Read up to this number of bytes"
          onChange={read_bytes => onChange(devices => // @ts-ignore
              devices.capture.read_bytes = read_bytes
          )}/>
    </>
    }
    {(capture.type === 'Bluez') && <>
      <OptionalTextOption
          value={capture.service}
          error={errors.messageFor('service')}
          desc="service"
          tooltip="Name of d-bus service"
          onChange={service => onChange(devices => // @ts-ignore
              devices.capture.service = service
          )}/>
      <TextOption
          value={capture.dbus_path}
          error={errors.messageFor('dbus_path')}
          desc="dbus_path"
          tooltip="d-bus path to Bluez"
          onChange={dbus_path => onChange(devices => // @ts-ignore
              devices.capture.dbus_path = dbus_path
          )}/>
    </>
    }
    <LabelListOption
      value={capture.labels ? capture.labels.map(lab => lab ? lab : "").join(",") : ""}
      error={errors.messageFor('labels')}
      desc="labels"
      onChange={updateChannelLabels}
      onButtonClick={toggleExpanded}
      />
    {expanded && makeDropdown()}
  </Box>
}

function PlaybackOptions(props: {
  hide_playback_device: boolean
  supported_playback_types?: PlaybackType[]
  playback: PlaybackDevice
  errors: Errors
  onChange: (update: Update<Devices>) => void
}) {
  const [popupState, setPopupState] = useState(false);
  const [availableDevices, setAvailableDevices] = useState([]);
  if (props.hide_playback_device)
    return null
  const defaults: { [type: string]: PlaybackDevice } = {
    Alsa: {type: 'Alsa', channels: 2, format: 'S32LE', device: "hw:0"},
    CoreAudio: {type: 'CoreAudio', channels: 2, format: null, device: null, exclusive: null},
    Pulse: {type: 'Pulse', channels: 2, format: 'S32LE', device: 'something'},
    Wasapi: {type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: null, exclusive: null},
    Jack: {type: 'Jack', channels: 2, device: 'default'},
    Stdout: {type: 'Stdout', channels: 2, format: 'S32LE'},
    File: {type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file', wav_header: false},
  }
  const {onChange, playback, errors, supported_playback_types} = props
  const defaultPlaybackTypes = Object.keys(defaults) as PlaybackType[]
  const playbackDeviceTypes = supported_playback_types ?
      defaultPlaybackTypes.filter(type => supported_playback_types.includes(type))
      : defaultPlaybackTypes
  if (!playbackDeviceTypes.includes(props.playback.type)) {
    // The selected type isn't available, change to one that is
    props.onChange(devices => devices.playback = defaults[playbackDeviceTypes[0]])
  }
  return <Box title="Playback device">
    <KeyValueSelectPopup
      key="playback select popup"
      open={popupState}
      header="Select playback device"
      items={availableDevices}
      onClose={() => setPopupState(false)}
      onSelect={device => onChange(devices => // @ts-ignore
        devices.playback.device = device
      )}
      />
    <ErrorMessage message={errors.rootMessage()}/>
    <EnumOption
        value={props.playback.type}
        error={errors.messageFor('type')}
        options={playbackDeviceTypes}
        tooltip="Audio backend for playback"
        desc="type"
        onChange={playbackType => props.onChange(devices => devices.playback = defaults[playbackType])}/>
    <IntOption
        value={playback.channels}
        error={errors.messageFor('channels')}
        desc="channels"
        tooltip="Number of channels"
        withControls={true}
        min={1}
        onChange={channels => onChange(devices => devices.playback.channels = channels)}/>
    {(playback.type !== 'Jack' && playback.type !== 'CoreAudio' && playback.type !== 'Alsa') &&
    <EnumOption
        value={playback.format}
        error={errors.messageFor('format')}
        options={Formats}
        desc="sampleformat"
        tooltip="Sample format"
        onChange={format => onChange(devices =>  // @ts-ignore
          devices.playback.format = format
        )}/>
    }
    {(playback.type === 'CoreAudio' || playback.type === 'Alsa') &&
    <OptionalEnumOption
        value={playback.format}
        error={errors.messageFor('format')}
        options={Formats}
        desc="sampleformat"
        tooltip="Sample format"
        onChange={format => onChange(devices =>  // @ts-ignore
          devices.playback.format = format
        )}/>
    }
    {(playback.type === 'Alsa') &&
      <DeviceOption
        value={playback.device}
        desc="device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}
        error={errors.messageFor('device')}
        onButtonClick={() => {
          fetch("/api/playbackdevices/" + playback.type)
            .then(devices => devices.json())
            .then(names => setAvailableDevices(names))
          setPopupState(true)
        }} />
    }
    {(playback.type === 'CoreAudio' || playback.type === 'Wasapi') &&
      <OptionalDeviceOption
        value={playback.device}
        desc="device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}
        error={errors.messageFor('device')}
        onButtonClick={() => {
          fetch("/api/playbackdevices/" + playback.type)
            .then(devices => devices.json())
            .then(names => setAvailableDevices(names))
          setPopupState(true)
        }} />
    }
    {(playback.type === 'Pulse') &&
    <TextOption
        value={playback.device}
        error={errors.messageFor('device')}
        desc="device"
        tooltip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}/>
    }
    {(playback.type === 'Wasapi' || playback.type === 'CoreAudio') &&
    <OptionalBoolOption
        value={playback.exclusive}
        error={errors.messageFor('device')}
        desc="exclusive"
        tooltip="Use exclusive mode"
        onChange={exclusive => onChange(devices => // @ts-ignore
            devices.playback.exclusive = exclusive
        )}/>
    }
    {playback.type === 'File' && <>
    <TextOption
        value={playback.filename}
        error={errors.messageFor('filename')}
        desc="filename"
        tooltip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.playback.filename = filename
        )}/>
    <OptionalBoolOption
        value={playback.wav_header}
        error={errors.messageFor('device')}
        desc="wav_header"
        tooltip="Write output as a wav file"
        onChange={wav_header => onChange(devices => // @ts-ignore
            devices.playback.wav_header = wav_header
        )}/>
      </>
    }
  </Box>
}

function DeviceOption(props: {
  value: string
  error?: string
  desc: string
  onChange: (device: string) => void
  onButtonClick: () => void
}) {
  return <div className="setting" data-tooltip-html="Name of device">
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <TextInput
        value={props.value}
        tooltip="Name of device"
        className="setting-input"
        style={{width: '87%'}}
        onChange={props.onChange}/>
    <MdiButton
        icon={mdiMagnify}
        tooltip="Pick a device"
        onClick={props.onButtonClick}
        className='setting-button'
        style={{width: '13%'}}
        buttonSize="small"
    />
    <ErrorMessage message={props.error}/>
  </div>
}

function OptionalDeviceOption(props: {
  value: string | null
  error?: string
  desc: string
  onChange: (device: string | null) => void
  onButtonClick: () => void
}) {
  return <div className="setting" data-tooltip-html="Name of device">
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <OptionalTextInput
        value={props.value}
        tooltip="Name of device"
        className="setting-input"
        style={{width: '87%'}}
        onChange={props.onChange}/>
    <MdiButton
        icon={mdiMagnify}
        tooltip="Pick a device"
        onClick={props.onButtonClick}
        className='setting-button'
        style={{width: '13%'}}
        buttonSize="small"
    />
    <ErrorMessage message={props.error}/>
  </div>
}

