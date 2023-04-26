import React from "react"
import "./index.css"
import {CaptureDevice, Config, Devices, Formats, PlaybackDevice, Resampler, ResamplerType, ResamplerTypes, AsyncSincInterpolations, defaultResampler, defaultSincResampler, AsyncSincProfile, AsyncSincProfiles, AsyncSincWindows, AsyncPolyInterpolations} from "./camilladsp/config"
import {CaptureType, GuiConfig, PlaybackType} from "./guiconfig"
import {
  add_default_option,
  default_to_null,
  null_to_default,
  OptionalBoolOption,
  Box,
  EnumInput,
  EnumOption,
  OptionalEnumOption,
  ErrorMessage,
  OptionalFloatOption,
  IntInput,
  OptionalIntInput,
  OptionalIntOption,
  IntOption,
  TextOption,
  OptionalTextOption
} from "./utilities/ui-components"
import {ErrorsForPath, errorsForSubpath} from "./utilities/errors"
import {Update} from "./utilities/common"

// TODO add volume_ramp_time
// TODO redo resampler config

export function DevicesTab(props: {
  guiConfig: GuiConfig
  devices: Devices
  errors: ErrorsForPath
  updateConfig: (update: Update<Config>) => void
}) {
  const updateDevices = (update: Update<Devices>) => props.updateConfig(config => update(config.devices))
  const {guiConfig, devices, errors} = props
  return <div className="tabpanel">
    <ErrorMessage message={errors({path: []})}/>
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
    <CaptureOptions
        hide_capture_device={guiConfig.hide_capture_device}
        supported_capture_types={guiConfig.supported_capture_types}
        capture={devices.capture}
        errors={errorsForSubpath(errors, 'capture')}
        onChange={updateDevices}/>
    <PlaybackOptions
        hide_playback_device={guiConfig.hide_playback_device}
        supported_playback_types={guiConfig.supported_playback_types}
        playback={devices.playback}
        errors={errorsForSubpath(errors, 'playback')}
        onChange={updateDevices}
    />
  </div>
}

function Samplerate(props: {
  hide_capture_samplerate: boolean
  devices: Devices
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_capture_samplerate && props.devices.resampler !== null)
    return null
  return <SamplerateOption
      samplerate={props.devices.samplerate}
      error={props.errors({path: ['samplerate']})}
      desc="samplerate"
      data-tip="Sample rate for processing and output"
      onChange={samplerate => props.onChange(devices => { devices.samplerate = samplerate })}
      extraPadding={true}
  />
}

function SamplerateOption(props: {
  samplerate: number
  error?: string
  desc: string
  'data-tip': string
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
  return <div className="setting" data-tip={props["data-tip"]} style={{padding: padding}}>
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <EnumInput
        value={isNonDefaultSamplerate(samplerate) ? other : samplerate.toString()}
        options={defaultSampleRates.map(samplerate => samplerate.toString()).concat([other])}
        desc={props.desc}
        data-tip={props["data-tip"]}
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
        data-tip={props["data-tip"]}
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
  'data-tip': string
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
  var value: null | string 
  if (samplerate !== null) {
    value = isNonDefaultSamplerate(samplerate) ? other : samplerate.toString()
  } else {
    value = samplerate
  }
  const options = defaultSampleRates.map(samplerate => samplerate.toString()).concat([other])
  add_default_option(options, "default")
  return <div className="setting" data-tip={props["data-tip"]} style={{padding: padding}}>
    <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
    <EnumInput
        value={null_to_default(value, "default")}
        options={options}
        desc={props.desc}
        data-tip={props["data-tip"]}
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
        data-tip={props["data-tip"]}
        className="setting-input"
        style={{width: '60%'}}
        onChange={(samplerate: number | null) => props.onChange(samplerate)}/>
    }
    <ErrorMessage message={props.error}/>
  </div>
}

function BufferOptions(props: {
  devices: Devices,
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  return <Box title="Buffers">
    <IntOption
        value={props.devices.chunksize}
        error={props.errors({path: ['chunksize']})}
        desc="chunksize"
        data-tip="Chunksize for the processing"
        onChange={chunksize => props.onChange(devices => devices.chunksize = chunksize)}/>
    <OptionalIntOption
        value={props.devices.queuelimit}
        error={props.errors({path: ['queuelimit']})}
        desc="queuelimit"
        data-tip="Length limit for internal queues"
        onChange={queuelimit => props.onChange(devices => devices.queuelimit = queuelimit)}/>
  </Box>
}

function SilenceOptions(props: {
  hide_silence: boolean
  devices: Devices
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_silence)
    return null
  return <Box title="Silence">
    <OptionalFloatOption
        value={props.devices.silence_threshold}
        error={props.errors({path: ['silence_threshold']})}
        desc="silence_threshold"
        data-tip="Threshold for silence in dB"
        onChange={silenceThreshold => props.onChange(devices => devices.silence_threshold = silenceThreshold)}/>
    <OptionalFloatOption
        value={props.devices.silence_timeout}
        error={props.errors({path: ['silence_timeout']})}
        desc="silence_timeout"
        data-tip="Pause processing after this many seconds of silence"
        onChange={silenceTimeout => props.onChange(devices => devices.silence_timeout = silenceTimeout)}/>
  </Box>
}

function RateAdjustOptions(props: {
  devices: Devices
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  let playbackDeviceIsOneOf = (types: string[]) => types.includes(props.devices.playback.type)
  if (playbackDeviceIsOneOf(["File", "Stdout", "Pulse"]))
    return null
  return <Box title="Rate adjust">
    <OptionalBoolOption
        value={props.devices.enable_rate_adjust}
        error={props.errors({path: ['enable_rate_adjust']})}
        desc="enable_rate_adjust"
        data-tip="Enable rate adjust"
        onChange={enableRateAdjust => props.onChange(devices => devices.enable_rate_adjust = enableRateAdjust)}/>
    <OptionalIntOption
        value={props.devices.adjust_period}
        error={props.errors({path: ['adjust_period']})}
        desc="adjust_period"
        data-tip="Delay in seconds between rate adjustments"
        onChange={adjustPeriod => props.onChange(devices => devices.adjust_period = adjustPeriod)}/>
    <OptionalIntOption
        value={props.devices.target_level}
        error={props.errors({path: ['target_level']})}
        desc="target_level"
        data-tip="Target output buffer fill level for rate adjust"
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
  errors: ErrorsForPath
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  const {devices, errors} = props
  console.log(devices.resampler)
  return <Box title="Resampling">
    <OptionalEnumOption
        value={devices.resampler? devices.resampler.type : null}
        error={errors({path: ['resampler.type']})}
        options={ResamplerTypes}
        desc="resampler_type"
        data-tip="Resampler type"
        placeholder="none"
        onChange={resamplerType => props.onChange(devices => devices.resampler = changeResamplerType(resamplerType))}/>
    {devices.resampler && devices.resampler.type === 'AsyncSinc' &&
    <EnumOption
        // @ts-ignore
        value={devices.resampler.hasOwnProperty("profile") ? devices.resampler.profile : "Free"}
        error={errors({path: ['resampler.type']})}
        options={AsyncSincProfiles}
        desc="profile"
        data-tip="AsyncSinc resampler profile"
        onChange={profile => props.onChange(devices => devices.resampler = changeResamplerProfile(profile))}/>
    }
    {devices.resampler && devices.resampler.type === 'AsyncSinc' && !devices.resampler.hasOwnProperty("profile") &&
    <>
      <EnumOption
        // @ts-ignore
        value={devices.resampler.interpolation}
        error={errors({path: ['interpolation']})}
        options={AsyncSincInterpolations}
        desc="interpolation"
        data-tip="Interpolation order"
        // @ts-ignore
        onChange={interp => props.onChange(devices => devices.resampler.interpolation = interp)}/>
      <IntOption
        // @ts-ignore
        value={devices.resampler.sinc_len}
        error={errors({path: ['sinc_len']})}
        desc="sinc_len"
        data-tip="Length of sinc interpolation filter"
        // @ts-ignore
        onChange={len => props.onChange(devices => devices.resampler.sinc_len = len)}/>
      <IntOption
        // @ts-ignore
        value={devices.resampler.oversampling_factor}
        error={errors({path: ['oversampling_factor']})}
        desc="oversampling_factor"
        data-tip="Oversampling factor"
        // @ts-ignore
        onChange={factor => props.onChange(devices => devices.resampler.oversampling_factor = factor)}/>
      <OptionalFloatOption
        // @ts-ignore
        value={devices.resampler.f_cutoff}
        error={errors({path: ['f_cutoff']})}
        desc="f_cutoff"
        data-tip="Relative cutoff frequency of interpolation filter"
        // @ts-ignore
        onChange={cutoff => props.onChange(devices => devices.resampler.f_cutoff = cutoff)}/>
      <EnumOption
        // @ts-ignore
        value={devices.resampler.window}
        error={errors({path: ['window']})}
        options={AsyncSincWindows}
        desc="window"
        data-tip="Window function for interpolation filter"
        // @ts-ignore
        onChange={window => props.onChange(devices => devices.resampler.window = window)}/>
    </>}
    {devices.resampler && devices.resampler.type === 'AsyncPoly' &&
    <EnumOption
      // @ts-ignore
      value={devices.resampler.interpolation}
      error={errors({path: ['interpolation']})}
      options={AsyncPolyInterpolations}
      desc="interpolation"
      data-tip="Interpolation order"
      // @ts-ignore
      onChange={interp => props.onChange(devices => devices.resampler.interpolation = interp)}/> }
    {!props.hide_capture_samplerate && devices.resampler !== null &&
    <OptionalSamplerateOption
        samplerate={devices.capture_samplerate}
        error={errors({path: ['capture_samplerate']})}
        desc="capture_samplerate"
        data-tip="Sample rate for capture device.<br>If different from 'samplerate' then resampling must be enabled"
        onChange={captureSamplerate => props.onChange(devices => devices.capture_samplerate = captureSamplerate)}/>
    }
  </Box>
}

function RateMonitoringOptions(props: {
    hide_rate_monitoring: boolean
    devices: Devices
    errors: ErrorsForPath
    error?: string
    onChange: (update: Update<Devices>) => void
  }) {
    if (props.hide_rate_monitoring)
        return null
    return <Box title="Capture rate monitoring">
        <OptionalFloatOption
            value={props.devices.rate_measure_interval}
            error={props.errors({path: ['rate_measure_interval']})}
            desc="rate_measure_interval"
            data-tip="Interval for rate measurements, in seconds"
            onChange={rateMeasureInterval => props.onChange(devices => devices.rate_measure_interval = rateMeasureInterval)}/>
        <OptionalBoolOption
            value={props.devices.stop_on_rate_change}
            error={props.errors({path: ['stop_on_rate_change']})}
            desc="stop_on_rate_change"
            data-tip="Stop processing when a sample rate change is detected"
            onChange={stopOnRateChange => props.onChange(devices => devices.stop_on_rate_change = stopOnRateChange)}/>
    </Box>
  }

function CaptureOptions(props: {
  hide_capture_device: boolean
  supported_capture_types?: CaptureType[]
  capture: CaptureDevice
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_capture_device)
    return null
  const defaults: { [type: string]: CaptureDevice } = {
    Alsa: { type: 'Alsa', channels: 2, format: 'S32LE', device: null },
    CoreAudio: { type: 'CoreAudio', channels: 2, format: null, device: null, change_format: null },
    Pulse: { type: 'Pulse', channels: 2, format: 'S32LE', device: 'something' },
    Wasapi: { type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: null, exclusive: false, loopback: false},
    Jack: { type: 'Jack', channels: 2, device: 'default'},
    Stdin: { type: 'Stdin', channels: 2, format: 'S32LE', extra_samples: null, skip_bytes: null, read_bytes: null },
    File: { type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file',
      extra_samples: null, skip_bytes: null, read_bytes: null },
    Bluez: { type: 'Bluez', service: null, dbus_path: 'dbus_path', format: 'S16LE', channels: 2}
  }
  const {capture, onChange, errors, supported_capture_types} = props
  const defaultCaptureTypes = Object.keys(defaults) as CaptureType[];
  const captureTypes = supported_capture_types ?
      defaultCaptureTypes.filter(type => supported_capture_types.includes(type))
      : defaultCaptureTypes
  return <Box title="Capture device">
    <ErrorMessage message={errors({path: []})}/>
    <EnumOption
        value={capture.type}
        error={errors({path: ['type']})}
        options={captureTypes}
        desc="type"
        data-tip="Audio backend for capture"
        onChange={captureType => onChange(devices => devices.capture = defaults[captureType])}/>
    <IntOption
        value={capture.channels}
        error={errors({path: ['channels']})}
        desc="channels"
        data-tip="Number of channels"
        withControls={true}
        min={1}
        onChange={channels => onChange(devices => devices.capture.channels = channels)}/>
    {(capture.type !== 'Jack' && capture.type !== 'CoreAudio') &&
    <EnumOption
        value={capture.format}
        error={errors({path: ['format']})}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices => // @ts-ignore
            devices.capture.format = format
        )}/>
    }
    {(capture.type === 'CoreAudio') &&
    <OptionalEnumOption
        value={capture.format}
        error={errors({path: ['format']})}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices => // @ts-ignore
            devices.capture.format = format
        )}/>
    }
    {(capture.type === 'CoreAudio' || capture.type === 'Alsa' || capture.type === 'Wasapi') &&
    <OptionalTextOption
        value={capture.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}/>
    }
    {(capture.type === 'Pulse') &&
    <TextOption
        value={capture.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}/>
    }
    {(capture.type === 'Wasapi') && <>
        <OptionalBoolOption
            value={capture.exclusive}
            error={errors({path: ['exclusive']})}
            desc="exclusive"
            data-tip="Use exclusive mode"
            onChange={exclusive => onChange(devices => // @ts-ignore
                devices.capture.exclusive = exclusive
            )}/>
        <OptionalBoolOption
            value={capture.loopback}
            error={errors({path: ['loopback']})}
            desc="loopback"
            data-tip="Use loopback capture mode to capture from a playback device"
            onChange={loopback => onChange(devices => // @ts-ignore
                devices.capture.loopback = loopback
            )}/>
        </>
    }
    {(capture.type === 'CoreAudio') &&
    <OptionalBoolOption
        value={capture.change_format}
        error={errors({path: ['device']})}
        desc="change_format"
        data-tip="Change format of the device"
        onChange={change_format => onChange(devices => // @ts-ignore
            devices.capture.change_format = change_format
        )}/>
    }
    {capture.type === 'File' &&
    <TextOption
        value={capture.filename}
        error={errors({path: ['filename']})}
        desc="filename"
        data-tip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.capture.filename = filename
        )}/>
    }
    {(capture.type === 'File' || capture.type === 'Stdin') && <>
      <OptionalIntOption
          value={capture.extra_samples}
          error={errors({path: ['extra_samples']})}
          desc="extra_samples"
          data-tip="Number of extra samples to insert after end of file"
          onChange={extra_samples => onChange(devices => // @ts-ignore
              devices.capture.extra_samples = extra_samples
          )}/>
      <OptionalIntOption
          value={capture.skip_bytes}
          error={errors({path: ['skip_bytes']})}
          desc="skip_bytes"
          data-tip="Number of bytes to skip at beginning of file"
          onChange={skip_bytes => onChange(devices => // @ts-ignore
              devices.capture.skip_bytes = skip_bytes
          )}/>
      <OptionalIntOption
          value={capture.read_bytes}
          error={errors({path: ['read_bytes']})}
          desc="read_bytes"
          data-tip="Read up to this number of bytes"
          onChange={read_bytes => onChange(devices => // @ts-ignore
              devices.capture.read_bytes = read_bytes
          )}/>
    </>
    }
    {(capture.type === 'Bluez') && <>
      <OptionalTextOption
          value={capture.service}
          error={errors({path: ['service']})}
          desc="service"
          data-tip="Name of d-bus service"
          onChange={service => onChange(devices => // @ts-ignore
              devices.capture.service = service
          )}/>
      <TextOption
          value={capture.dbus_path}
          error={errors({path: ['dbus_path']})}
          desc="dbus_path"
          data-tip="d-bus path to Bluez"
          onChange={dbus_path => onChange(devices => // @ts-ignore
              devices.capture.dbus_path = dbus_path
          )}/>
    </>
    }
  </Box>
}

function PlaybackOptions(props: {
  hide_playback_device: boolean
  supported_playback_types?: PlaybackType[]
  playback: PlaybackDevice
  errors: ErrorsForPath
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_playback_device)
    return null
  const defaults: { [type: string]: PlaybackDevice } = {
    Alsa: {type: 'Alsa', channels: 2, format: 'S32LE', device: null},
    CoreAudio: {type: 'CoreAudio', channels: 2, format: null, device: null, exclusive: null, change_format: null},
    Pulse: {type: 'Pulse', channels: 2, format: 'S32LE', device: 'something'},
    Wasapi: {type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: null, exclusive: null},
    Jack: {type: 'Jack', channels: 2, device: 'default'},
    Stdout: {type: 'Stdout', channels: 2, format: 'S32LE'},
    File: {type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file'},
  }
  const {onChange, playback, errors, supported_playback_types} = props
  const defaultPlaybackTypes = Object.keys(defaults) as PlaybackType[]
  const playbackDeviceTypes = supported_playback_types ?
      defaultPlaybackTypes.filter(type => supported_playback_types.includes(type))
      : defaultPlaybackTypes
  return <Box title="Playback device">
    <ErrorMessage message={errors({path: []})}/>
    <EnumOption
        value={props.playback.type}
        error={errors({path: ['type']})}
        options={playbackDeviceTypes}
        data-tip="Audio backend for playback"
        desc="type"
        onChange={playbackType => props.onChange(devices => devices.playback = defaults[playbackType])}/>
    <IntOption
        value={playback.channels}
        error={errors({path: ['channels']})}
        desc="channels"
        data-tip="Number of channels"
        withControls={true}
        min={1}
        onChange={channels => onChange(devices => devices.playback.channels = channels)}/>
    {(playback.type !== 'Jack' && playback.type !== 'CoreAudio') &&
    <EnumOption
        value={playback.format}
        error={errors({path: ['format']})}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices =>  // @ts-ignore
          devices.playback.format = format
        )}/>
    }
    {(playback.type === 'CoreAudio') &&
    <OptionalEnumOption
        value={playback.format}
        error={errors({path: ['format']})}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices =>  // @ts-ignore
          devices.playback.format = format
        )}/>
    }
    {(playback.type === 'CoreAudio' || playback.type === 'Alsa' || playback.type === 'Wasapi') &&
    <OptionalTextOption
        value={playback.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}/>
    }
    {(playback.type === 'Pulse') &&
    <TextOption
        value={playback.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}/>
    }
    {(playback.type === 'Wasapi' || playback.type === 'CoreAudio') &&
    <OptionalBoolOption
        value={playback.exclusive}
        error={errors({path: ['device']})}
        desc="exclusive"
        data-tip="Use exclusive mode"
        onChange={exclusive => onChange(devices => // @ts-ignore
            devices.playback.exclusive = exclusive
        )}/>
    }
    {(playback.type === 'CoreAudio') &&
    <OptionalBoolOption
        value={playback.change_format}
        error={errors({path: ['device']})}
        desc="change_format"
        data-tip="Change format of the device"
        onChange={change_format => onChange(devices => // @ts-ignore
            devices.playback.change_format = change_format
        )}/>
    }
    {playback.type === 'File' &&
    <TextOption
        value={playback.filename}
        error={errors({path: ['filename']})}
        desc="filename"
        data-tip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.playback.filename = filename
        )}/>
    }
  </Box>
}