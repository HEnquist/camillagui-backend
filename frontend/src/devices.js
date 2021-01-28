import React from "react";
import "./index.css";
import {EnumSelect, ParameterInput} from "./common.js";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";

export class Devices extends React.Component {
  constructor(props) {
    super(props);
    this.handleChangeParams = this.handleChangeParams.bind(this);
    this.handlePlayback = this.handlePlayback.bind(this);
    this.handleCapture = this.handleCapture.bind(this);
    this.state = { config: cloneDeep(this.props.config) };
  }

  componentDidUpdate() {
    if (!isEqual(this.props.config, this.state.config)) {
      this.setState({ config: cloneDeep(this.props.config) });
    }
  }

  handleChangeParams(params) {
    this.setState((state) => {
      console.log("devices got:", params);
      state.config = Object.assign(state.config, params);
      console.log("devices new:", state);
      this.props.onChange(state.config);
      return state;
    });
  }

  handlePlayback(params) {
    this.setState((state) => {
      console.log("devices got:", params);
      state.config.playback = params;
      console.log("devices new:", state);
      this.props.onChange(state.config);
      return state;
    });
  }

  handleCapture(params) {
    this.setState((state) => {
      console.log("devices got:", params);
      state.config.capture = params;
      console.log("devices new:", state);
      this.props.onChange(state.config);
      return state;
    });
  }

  render() {
    const guiConfig = this.props.guiConfig;
    const config = this.state.config;
    return (
      <div className="devices">
          <Samplerate
              hide_capture_samplerate={guiConfig.hide_capture_samplerate}
              config={config}
              onChange={this.handleChangeParams}
          />
          <BufferOptions
              config={config}
              onChange={this.handleChangeParams}
          />
          <SilenceOptions
              hide_silence={guiConfig.hide_silence}
              config={config}
              onChange={this.handleChangeParams}
          />
          <RateAdjustOptions
              config={config}
              onChange={this.handleChangeParams}
          />
          <ResamplingOptions
              hide_capture_samplerate={guiConfig.hide_capture_samplerate}
              config={config}
              onChange={this.handleChangeParams}
          />
          <Capture
            parameters={config.capture}
            hide_capture_device={guiConfig.hide_capture_device}
            onChange={this.handleCapture}
          />
          <Playback
            parameters={config.playback}
            hide_playback_device={guiConfig.hide_playback_device}
            onChange={this.handlePlayback}
          />
      </div>
    );
  }
}

function Samplerate(props) {
  if (props.hide_capture_samplerate && !props.config.enable_resampling)
    return null;
  else
    return <ParameterInput
        parameters={{samplerate: props.config.samplerate}}
        onChange={props.onChange}
    />;
}

function RateAdjustOptions(props) {
  let playbackDeviceIsOneOf = (types) => types.includes(props.config.playback.type);
  if (playbackDeviceIsOneOf(["File", "Stdout", "Pulse"]))
    return null;
  return <Group
      title="Rate adjust"
      propertyNames={['enable_rate_adjust', 'adjust_period', 'target_level']}
      config={props.config}
      onChange={props.onChange}
  />;
}

function Group(props) {
  const properties = props.propertyNames.map((property, idx) => {
    return <ParameterInput
        key={idx}
        parameters={{[property]: props.config[property]}}
        onChange={props.onChange}
    />;
  });
  return <>
    <div className="desc">{props.title}</div>
    <div className="group">
      {properties}
    </div>
  </>;
}

function BufferOptions(props) {
  return <Group
      title="Buffers"
      propertyNames={['chunksize', 'queuelimit']}
      config={props.config}
      onChange={props.onChange}
  />
}

function SilenceOptions(props) {
  if (props.hide_silence)
    return null;
  return <Group
      title="Silence"
      propertyNames={['silence_threshold', 'silence_timeout']}
      config={props.config}
      onChange={props.onChange}
  />
}

function ResamplingOptions(props) {
  const propertyNames = props.hide_capture_samplerate ?
      ['enable_resampling', 'resampler_type'] :
      ['enable_resampling', 'resampler_type', 'capture_samplerate'];
  return <Group
      title="Resampling"
      propertyNames={propertyNames}
      config={props.config}
      onChange={props.onChange}
  />
}

export class Capture extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { parameters: cloneDeep(props.parameters) };
    console.log(this.state);
  }

  componentDidUpdate() {
    if (!isEqual(this.props.parameters, this.state.parameters)) {
      this.setState({ parameters: cloneDeep(this.props.parameters) });
    }
  }

  handleChange(parameters) {
    this.setState((prevState) => {
      const state = Object.assign(prevState, parameters);
      console.log("capture new", state, "got", parameters);
      this.props.onChange(parameters);
      return state;
    });
  }

  templates = {
    Alsa: { type: "Alsa", channels: 2, format: "S32LE", device: "hw:0" },
    File: {
      type: "File",
      channels: 2,
      format: "S32LE",
      filename: "/path/to/file",
      extra_samples: 0,
      skip_bytes: 0,
      read_bytes: 0,
    },
    Stdin: {
      type: "Stdin",
      channels: 2,
      format: "S32LE",
      extra_samples: 0,
      skip_bytes: 0,
      read_bytes: 0,
    },
    Pulse: { type: "Pulse", channels: 2, format: "S32LE", device: "something" },
    Wasapi: {
      type: "Wasapi",
      channels: 2,
      format: "FLOAT32LE",
      device: "blablawin",
    },
    CoreAudio: {
      type: "CoreAudio",
      channels: 2,
      format: "FLOAT32LE",
      device: "blablamac",
    },
  };

  handleBackend = (selectValue) => {
    this.setState((prevState) => {
      const type = selectValue;
      const parameters = cloneDeep(this.templates[type]);
      console.log("capture", parameters);
      this.props.onChange(parameters);
      return { parameters };
    });
  };

  render() {
    if (this.props.hide_capture_device)
      return null;
    var backendparams = (
      <ParameterInput
        parameters={this.state.parameters}
        onChange={this.handleChange}
      />
    );
    return (
      <div>
        <div className="desc">Capture device</div>
        <div className="group">
          <div className="row">
            <EnumSelect
              desc="type"
              data-tip="Audio backend for capture"
              type="backend_capture"
              value={this.state.parameters.type}
              onSelect={this.handleBackend}
            />
          </div>
          <div className="row">{backendparams}</div>
        </div>
      </div>
    );
  }
}

export class Playback extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { parameters: cloneDeep(props.parameters) };
    //this.state = { parameters: { type: "Alsa", ...cloneDeep(this.templates["Alsa"]) } };
    console.log(this.state);
  }

  componentDidUpdate() {
    if (!isEqual(this.props.parameters, this.state.parameters)) {
      this.setState({ parameters: cloneDeep(this.props.parameters) });
    }
  }

  handleChange(parameters) {
    this.setState((prevState) => {
      const state = Object.assign(prevState, parameters);
      //state.parameters = parameters;
      console.log("playback new", state, "got", parameters);
      this.props.onChange(parameters);
      return state;
    });
  }

  templates = {
    Alsa: { type: "Alsa", channels: 2, format: "S32LE", device: "hw:0" },
    File: {
      type: "File",
      channels: 2,
      format: "S32LE",
      filename: "/path/to/file",
    },
    Stdout: { type: "Stdout", channels: 2, format: "S32LE" },
    Pulse: { type: "Pulse", channels: 2, format: "S32LE", device: "something" },
    Wasapi: {
      type: "Wasapi",
      channels: 2,
      format: "FLOAT32LE",
      device: "blablawin",
    },
    CoreAudio: {
      type: "CoreAudio",
      channels: 2,
      format: "FLOAT32LE",
      device: "blablamac",
    },
  };

  handleBackend = (selectValue) => {
    this.setState((prevState) => {
      const type = selectValue;
      const parameters = cloneDeep(this.templates[type]);
      console.log("playback", parameters);
      this.props.onChange(parameters);
      return { parameters };
    });
  };

  render() {
    if (this.props.hide_playback_device)
      return null;
    var backendparams = (
      <ParameterInput
        parameters={this.state.parameters}
        onChange={this.handleChange}
      />
    );
    return (
      <div>
        <div className="desc">Playback device</div>
        <div className="group">
          <div className="row">
            <EnumSelect
              key="backend"
              data-tip="Audio backend for playback"
              desc="type"
              type="backend_playback"
              value={this.state.parameters.type}
              onSelect={this.handleBackend}
            />
          </div>
          <div className="row">{backendparams}</div>
        </div>
      </div>
    );
  }
}

