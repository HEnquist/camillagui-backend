import React from "react";
import "./index.css";
import { ParameterInput, EnumSelect } from "./common.js";
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

  group(title, propertyNames) {
    var properties = propertyNames.map((property) => {
      return (
          <ParameterInput
              parameters={{[property]: this.state.config[property]}}
              onChange={this.handleChangeParams}
          />
      );
    });
    return (
        <>
          <div className="desc">{title}</div>
          <div className="group">
            {properties}
          </div>
        </>
    );
  }

  render() {
    return (
      <div className="devices">
          <ParameterInput
            parameters={{samplerate: this.state.config.samplerate}}
            onChange={this.handleChangeParams}
          />
          {this.group('Buffers', ['chunksize', 'target_level', 'queuelimit'])}
          {this.group('Silence', ['silence_threshold', 'silence_timeout'])}
          {this.group('Rate adjust', ['enable_rate_adjust', 'adjust_period'])}
          {this.group('Resampling', ['enable_resampling', 'resampler_type', 'capture_samplerate'])}
          <Capture
            parameters={this.state.config.capture}
            onChange={this.handleCapture}
          />
          <Playback
            parameters={this.state.config.playback}
            onChange={this.handlePlayback}
          />
      </div>
    );
  }
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

