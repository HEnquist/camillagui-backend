import React from "react"
import "./index.css"
import {CaptureDevice, Config, Devices, Formats, PlaybackDevice, ResamplerTypes} from "./config"
import {GuiConfig} from "./guiconfig"
import {
  BoolOption,
  Box,
  EnumInput,
  EnumOption,
  FloatOption,
  IntInput,
  IntOption,
  TextOption,
  Update
} from "./common-tsx";

export function DevicesTab(props: {
    guiConfig: GuiConfig,
    devices: Devices,
    updateConfig: (update: Update<Config>) => void
}) {
  const updateDevices = (update: Update<Devices>) => props.updateConfig(config => update(config.devices))
  const guiConfig = props.guiConfig;
  const devices = props.devices;
  return <div className="tabpanel">
    <Samplerate
        hide_capture_samplerate={guiConfig.hide_capture_samplerate}
        devices={devices}
        onChange={updateDevices}/>
    <BufferOptions
        devices={devices}
        onChange={updateDevices}/>
    <SilenceOptions
        hide_silence={guiConfig.hide_silence}
        devices={devices}
        onChange={updateDevices}/>
    <RateAdjustOptions
        devices={devices}
        onChange={updateDevices}/>
    <ResamplingOptions
        hide_capture_samplerate={guiConfig.hide_capture_samplerate}
        devices={devices}
        onChange={updateDevices}/>
    <CaptureOptions
        hide_capture_device={guiConfig.hide_capture_device}
        capture={devices.capture}
        onChange={updateDevices}/>
    <PlaybackOptions
      hide_playback_device={guiConfig.hide_playback_device}
      playback={devices.playback}
      onChange={updateDevices}
    />
  </div>;
}

function Samplerate(props: {
  hide_capture_samplerate: boolean,
  devices: Devices,
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_capture_samplerate && !props.devices.enable_resampling)
    return null;
  return <SamplerateOption
      samplerate={props.devices.samplerate}
      desc="samplerate"
      data-tip="Sample rate for processing and output"
      onChange={samplerate => props.onChange(devices => { devices.samplerate = samplerate })}
      extraPadding={true}
  />
}

function SamplerateOption(props: {
  samplerate: number
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
  const samplerate = props.samplerate;
  const padding = props.extraPadding ? '0 12px' : '0';
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
          props.onChange(newSamplerate);
        }}/>
    {isNonDefaultSamplerate(samplerate) &&
    <IntInput
        value={samplerate}
        data-tip={props["data-tip"]}
        className="setting-input"
        style={{width: '60%'}}
        onChange={samplerate => props.onChange(samplerate)}/>
    }
  </div>
}

function BufferOptions(props: {
  devices: Devices,
  onChange: (update: Update<Devices>) => void
}) {
  return <Box title="Buffers">
    <IntOption
        value={props.devices.chunksize}
        desc="chunksize"
        data-tip="Chunksize for the processing"
        onChange={chunksize => props.onChange(devices => devices.chunksize = chunksize)}/>
    <IntOption
        value={props.devices.queuelimit}
        desc="queuelimit"
        data-tip="Length limit for internal queues"
        onChange={queuelimit => props.onChange(devices => devices.queuelimit = queuelimit)}/>
  </Box>
}

function SilenceOptions(props: {
  hide_silence: boolean,
  devices: Devices,
  onChange: (update: Update<Devices>) => void
}) {
  if (props.hide_silence)
    return null;
  return <Box title="Silence">
    <FloatOption
        value={props.devices.silence_threshold}
        desc="silence_threshold"
        data-tip="Threshold for silence in dB"
        onChange={silenceThreshold => props.onChange(devices => devices.silence_threshold = silenceThreshold)}/>
    <FloatOption
        value={props.devices.silence_timeout}
        desc="silence_timeout"
        data-tip="Pause processing after this many seconds of silence"
        onChange={silenceTimeout => props.onChange(devices => devices.silence_timeout = silenceTimeout)}/>
  </Box>
}

function RateAdjustOptions(props: {
  devices: Devices,
  onChange: (update: Update<Devices>) => void
}) {
  let playbackDeviceIsOneOf = (types: string[]) => types.includes(props.devices.playback.type);
  if (playbackDeviceIsOneOf(["File", "Stdout", "Pulse"]))
    return null;
  return <Box title="Rate adjust">
    <BoolOption
        value={props.devices.enable_rate_adjust}
        desc="enable_rate_adjust"
        data-tip="Enable rate adjust"
        onChange={enableRateAdjust => props.onChange(devices => devices.enable_rate_adjust = enableRateAdjust)}/>
    <IntOption
        value={props.devices.adjust_period}
        desc="adjust_period"
        data-tip="Delay in seconds between rate adjustments"
        onChange={adjustPeriod => props.onChange(devices => devices.adjust_period = adjustPeriod)}/>
    <IntOption
        value={props.devices.target_level}
        desc="target_level"
        data-tip="Target output buffer fill level for rate adjust"
        onChange={targetLevel => props.onChange(devices => devices.target_level = targetLevel)}/>
  </Box>;
}

function ResamplingOptions(props: {
  hide_capture_samplerate: boolean,
  devices: Devices,
  onChange: (update: Update<Devices>) => void
}) {
  return <Box title="Resampling">
    <BoolOption
        value={props.devices.enable_resampling}
        desc="enable_resampling"
        data-tip="Enable rasampling"
        onChange={enableResampling => props.onChange(devices => devices.enable_resampling = enableResampling)}/>
    <EnumOption
        value={props.devices.resampler_type}
        options={ResamplerTypes}
        desc="resampler_type"
        data-tip="Resampler type"
        onChange={resampler => props.onChange(devices => devices.resampler_type = resampler)}/>
    {!props.hide_capture_samplerate &&
    <SamplerateOption
        samplerate={props.devices.capture_samplerate}
        desc="capture_samplerate"
        data-tip="Sample rate for capture device.<br>If different from 'samplerate' then resampling must be enabled"
        onChange={captureSamplerate => props.onChange(devices => devices.capture_samplerate = captureSamplerate)}/>
    }
  </Box>
}

function CaptureOptions(props: {
  hide_capture_device: boolean,
  capture: CaptureDevice,
  onChange: (update: Update<Devices>) => void
}) {

  const defaults: { [type: string]: CaptureDevice } = {
    Alsa: { type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0' },
    CoreAudio: { type: 'CoreAudio', channels: 2, format: 'FLOAT32LE', device: 'blablamac'},
    Pulse: { type: 'Pulse', channels: 2, format: 'S32LE', device: 'something' },
    Wasapi: { type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: 'blablawin'},
    Stdin: { type: 'Stdin', channels: 2, format: 'S32LE', extra_samples: 0, skip_bytes: 0, read_bytes: 0 },
    File: { type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file',
      extra_samples: 0, skip_bytes: 0, read_bytes: 0 },
  };

  if (props.hide_capture_device)
    return null;
  const {capture, onChange} = props
  return <Box title="Capture device">
    <EnumOption
        value={capture.type}
        options={Object.keys(defaults)}
        desc="type"
        data-tip="Audio backend for capture"
        onChange={captureType => onChange(devices => devices.capture = defaults[captureType])}/>
    <IntOption
        value={capture.channels}
        desc="channels"
        data-tip="Number of channels"
        withControls={true}
        min={1}
        onChange={channels => onChange(devices => devices.capture.channels = channels)}/>
    <EnumOption
        value={capture.format}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices => devices.capture.format = format)}/>
    {(capture.type === 'Alsa' || capture.type === 'CoreAudio' || capture.type === 'Pulse' || capture.type === 'Wasapi') &&
    <TextOption
        value={capture.device}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.capture.device = device
        )}/>
    }
    {capture.type === 'File' &&
    <TextOption
        value={capture.filename}
        desc="filename"
        data-tip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.capture.filename = filename
        )}/>
    }
    {(capture.type === 'File' || capture.type === 'Stdin') && <>
      <IntOption
          value={capture.extra_samples}
          desc="extra_samples"
          data-tip="Number of extra samples to insert after end of file"
          onChange={extra_samples => onChange(devices => // @ts-ignore
              devices.capture.extra_samples = extra_samples
          )}/>
      <IntOption
          value={capture.skip_bytes}
          desc="skip_bytes"
          data-tip="Number of bytes to skip at beginning of file"
          onChange={skip_bytes => onChange(devices => // @ts-ignore
              devices.capture.skip_bytes = skip_bytes
          )}/>
      <IntOption
          value={capture.read_bytes}
          desc="read_bytes"
          data-tip="Read up to this number of bytes"
          onChange={read_bytes => onChange(devices => // @ts-ignore
              devices.capture.read_bytes = read_bytes
          )}/>
    </>
    }
  </Box>;
}

function PlaybackOptions(props: {
  hide_playback_device: boolean
  playback: PlaybackDevice
  onChange: (update: Update<Devices>) => void
}) {

  const defaults: { [type: string]: PlaybackDevice } = {
    Alsa: {type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0'},
    CoreAudio: {type: 'CoreAudio', channels: 2, format: 'FLOAT32LE', device: 'blablamac'},
    Pulse: {type: 'Pulse', channels: 2, format: 'S32LE', device: 'something'},
    Wasapi: {type: 'Wasapi', channels: 2, format: 'FLOAT32LE', device: 'blablawin'},
    Stdout: {type: 'Stdout', channels: 2, format: 'S32LE'},
    File: {type: 'File', channels: 2, format: 'S32LE', filename: '/path/to/file'},
  };

  const {onChange, playback} = props
  return <Box title="Playback device">
    <EnumOption
        value={props.playback.type}
        options={Object.keys(defaults)}
        data-tip="Audio backend for playback"
        desc="type"
        onChange={playbackType => props.onChange(devices => devices.playback = defaults[playbackType])}/>
    <IntOption
        value={playback.channels}
        desc="channels"
        data-tip="Number of channels"
        withControls={true}
        min={1}
        onChange={channels => onChange(devices => devices.playback.channels = channels)}/>
    <EnumOption
        value={playback.format}
        options={Formats}
        desc="sampleformat"
        data-tip="Sample format"
        onChange={format => onChange(devices => devices.playback.format = format)}/>
    {(playback.type === 'Alsa' || playback.type === 'CoreAudio' || playback.type === 'Pulse' || playback.type === 'Wasapi') &&
    <TextOption
        value={playback.device}
        desc="device"
        data-tip="Name of device"
        onChange={device => onChange(devices => // @ts-ignore
            devices.playback.device = device
        )}/>
    }
    {playback.type === 'File' &&
    <TextOption
        value={playback.filename}
        desc="filename"
        data-tip="Filename including path"
        onChange={filename => onChange(devices => // @ts-ignore
            devices.playback.filename = filename
        )}/>
    }
  </Box>
}