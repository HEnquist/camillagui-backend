import React from "react"
import "./index.css"
import {CaptureDevice, Config, Devices, Formats, PlaybackDevice, ResamplerTypes} from "./config"
import {CaptureType, GuiConfig, PlaybackType} from "./guiconfig"
import {
  BoolOption,
  Box,
  EnumInput,
  EnumOption,
  ErrorMessage,
  FloatOption,
  IntInput,
  IntOption,
  TextOption
} from "./utilities/ui-components"
import {ErrorsForPath, errorsForSubpath} from "./utilities/errors"
import {Update} from "./utilities/common"

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
  if (props.hide_capture_samplerate && !props.devices.enable_resampling)
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
    <IntOption
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
    <FloatOption
        value={props.devices.silence_threshold}
        error={props.errors({path: ['silence_threshold']})}
        desc="silence_threshold"
        data-tip="Threshold for silence in dB"
        onChange={silenceThreshold => props.onChange(devices => devices.silence_threshold = silenceThreshold)}/>
    <FloatOption
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
    <BoolOption
        value={props.devices.enable_rate_adjust}
        error={props.errors({path: ['enable_rate_adjust']})}
        desc="enable_rate_adjust"
        data-tip="Enable rate adjust"
        onChange={enableRateAdjust => props.onChange(devices => devices.enable_rate_adjust = enableRateAdjust)}/>
    <IntOption
        value={props.devices.adjust_period}
        error={props.errors({path: ['adjust_period']})}
        desc="adjust_period"
        data-tip="Delay in seconds between rate adjustments"
        onChange={adjustPeriod => props.onChange(devices => devices.adjust_period = adjustPeriod)}/>
    <IntOption
        value={props.devices.target_level}
        error={props.errors({path: ['target_level']})}
        desc="target_level"
        data-tip="Target output buffer fill level for rate adjust"
        onChange={targetLevel => props.onChange(devices => devices.target_level = targetLevel)}/>
  </Box>
}

function ResamplingOptions(props: {
  hide_capture_samplerate: boolean
  devices: Devices
  errors: ErrorsForPath
  error?: string
  onChange: (update: Update<Devices>) => void
}) {
  const {devices, errors} = props
  return <Box title="Resampling">
    <BoolOption
        value={devices.enable_resampling}
        error={errors({path: ['enable_resampling']})}
        desc="enable_resampling"
        data-tip="Enable rasampling"
        onChange={enableResampling => props.onChange(devices => devices.enable_resampling = enableResampling)}/>
    <EnumOption
        value={devices.resampler_type}
        error={errors({path: ['resampler_type']})}
        options={ResamplerTypes}
        desc="resampler_type"
        data-tip="Resampler type"
        onChange={resampler => props.onChange(devices => devices.resampler_type = resampler)}/>
    {!props.hide_capture_samplerate &&
    <SamplerateOption
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
        <FloatOption
            value={props.devices.rate_measure_interval}
            error={props.errors({path: ['rate_measure_interval']})}
            desc="rate_measure_interval"
            data-tip="Interval for rate measurements, in seconds"
            onChange={rateMeasureInterval => props.onChange(devices => devices.rate_measure_interval = rateMeasureInterval)}/>
        <BoolOption
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
    Alsa: { type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0', retry_on_error: false, avoid_blocking_read: false },
    CoreAudio: { type: 'CoreAudio', channels: 2, format: 'FLOAT32LE', device: 'blablamac'},
    Pulse: { type: 'Pulse', channels: 2, format: 'S32LE', device: 'something' },
    Wasapi: { type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: 'blablawin', exclusive: false, loopback: false},
    Jack: { type: 'Jack', channels: 2, device: 'default'},
    Stdin: { type: 'Stdin', channels: 2, format: 'S32LE', extra_samples: 0, skip_bytes: 0, read_bytes: 0 },
    File: { type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file',
      extra_samples: 0, skip_bytes: 0, read_bytes: 0 },
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
    {(capture.type !== 'Jack') &&
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
    {(capture.type === 'Alsa' || capture.type === 'CoreAudio' || capture.type === 'Pulse' || capture.type === 'Wasapi') &&
    <TextOption
        value={capture.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}/>
    }
    {(capture.type === 'Alsa') && <>
        <BoolOption
            value={capture.retry_on_error}
            error={errors({path: ['device']})}
            desc="retry_on_error"
            data-tip="Retry reading from device on errors, may help with buggy devices"
            onChange={retry_on_error => onChange(devices => // @ts-ignore
                devices.capture.retry_on_error = retry_on_error
            )}/>
        <BoolOption
            value={capture.avoid_blocking_read}
            error={errors({path: ['device']})}
            desc="avoid_blocking_read"
            data-tip="Avoid blocking on reads, may help with buggy devices"
            onChange={avoid_blocking_read => onChange(devices => // @ts-ignore
                devices.capture.avoid_blocking_read = avoid_blocking_read
            )}/>
        </>
    }
    {(capture.type === 'Wasapi') && <>
        <BoolOption
            value={capture.exclusive}
            error={errors({path: ['exclusive']})}
            desc="exclusive"
            data-tip="Use exclusive mode"
            onChange={exclusive => onChange(devices => // @ts-ignore
                devices.capture.exclusive = exclusive
            )}/>
        <BoolOption
            value={capture.loopback}
            error={errors({path: ['loopback']})}
            desc="loopback"
            data-tip="Use loopback capture mode to capture from a playback device"
            onChange={loopback => onChange(devices => // @ts-ignore
                devices.capture.loopback = loopback
            )}/>
        </>
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
      <IntOption
          value={capture.extra_samples}
          error={errors({path: ['extra_samples']})}
          desc="extra_samples"
          data-tip="Number of extra samples to insert after end of file"
          onChange={extra_samples => onChange(devices => // @ts-ignore
              devices.capture.extra_samples = extra_samples
          )}/>
      <IntOption
          value={capture.skip_bytes}
          error={errors({path: ['skip_bytes']})}
          desc="skip_bytes"
          data-tip="Number of bytes to skip at beginning of file"
          onChange={skip_bytes => onChange(devices => // @ts-ignore
              devices.capture.skip_bytes = skip_bytes
          )}/>
      <IntOption
          value={capture.read_bytes}
          error={errors({path: ['read_bytes']})}
          desc="read_bytes"
          data-tip="Read up to this number of bytes"
          onChange={read_bytes => onChange(devices => // @ts-ignore
              devices.capture.read_bytes = read_bytes
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
    Alsa: {type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0'},
    CoreAudio: {type: 'CoreAudio', channels: 2, format: 'FLOAT32LE', device: 'blablamac'},
    Pulse: {type: 'Pulse', channels: 2, format: 'S32LE', device: 'something'},
    Wasapi: {type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: 'blablawin', exclusive: false},
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
    {(playback.type !== 'Jack') &&
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
    {(playback.type === 'Alsa' || playback.type === 'CoreAudio' || playback.type === 'Pulse' || playback.type === 'Wasapi') &&
    <TextOption
        value={playback.device}
        error={errors({path: ['device']})}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}/>
    }
    {(playback.type === 'Wasapi') &&
    <BoolOption
        value={playback.exclusive}
        error={errors({path: ['device']})}
        desc="exclusive"
        data-tip="Use exclusive mode"
        onChange={exclusive => onChange(devices => // @ts-ignore
            devices.playback.exclusive = exclusive
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