import React from 'react';
import './index.css';
import Popup from "reactjs-popup";


export class BoolSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { value: this.props.value };
  }

  handleChange(event) {
    this.setState({ value: event.target.checked });
    this.props.onChange({ id: this.props.id, value: event.target.checked });
  }

  render() {
    return (
      <div className="row">
        <div className="column left">
          {this.props.desc}
        </div>
        <div className="column right">
          <input type="checkbox" name={this.props.id} id={this.props.id} checked={this.state.value} onChange={this.handleChange}></input>
        </div>
      </div>
    );
  }
}


export class EnumSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { value: this.props.value };
  }

  enums = {
    "filter": ["Biquad", "BiquadCombo", "Conv", "Delay", "Gain", "Dither", "DiffEq"],
    "Biquad": ["Lowpass", "Highpass", "Highshelf", "Lowshelf", "LowpassFO", "HighpassFO", "HighshelfFO", "LowshelfFO", "Peaking", "Notch"],
    "BiquadCombo": ["ButterworthHighpass", "ButterworthLowpass", "LinkwitzRileyHighpass", "LinkwitzRileyLowpass"],
    "coeffformat": ["S16LE", "S24LE", "S24LE3", "S32LE", "FLOAT32LE", "FLOAT64LE", "TEXT"],
    "sampleformat": ["S16LE", "S24LE", "S24LE3", "S32LE", "FLOAT32LE", "FLOAT64LE"],
    "resampler": ["FastAsync", "BalancedAsync", "AccurateAsync", "Synchronous"],
    "delayunit": ["ms", "samples"],
    "Conv": ["File", "Values"],
    "backend": ["Alsa", "PulseAudio", "Wasapi", "CoreAudio", "File"],
    "Dither": ["Simple", "Uniform", "Lipshitz441", "Fweighted441", "Shibata441", "Shibata48", "None"],
    "pipelineitem": ["Mixer", "Filter"]
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onSelect(event.target.value);
  }

  render() {
    var vals = this.enums[this.props.type];
    if (!vals) {
      return "";
    }
    var fields = vals.map(
      (val) => {
        return (
          <option key={val} value={val}>{val}</option>
        )
      }
    )
    return (
      <div className="row">
        <div className="column left">
          {this.props.desc}
        </div>
        <div className="column right">
          <select name={this.props.desc} id={this.props.desc} value={this.state.value} onChange={this.handleChange}>
            {fields}
          </select>
        </div>
      </div>
    );
  }
}

export class InputField extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { value: this.props.value };
    this.handleChange = this.handleChange.bind(this);
    this.debounceChange = this.debounceChange.bind(this);
    this.delayTimer = null;
    this.newValue = null;
  }

  debounceChange() {
    clearTimeout(this.delayTimer);
    this.delayTimer = setTimeout(() => {
      this.props.onChange({ id: this.props.id, value: this.newValue });
    }, 1000);
  }

  handleChange(event) {
    console.log("event value:", event.target.value);
    var value;
    if (this.props.type === "float") {
      value = parseFloat(event.target.value);
    }
    else if (this.props.type === "int") {
      value = parseInt(event.target.value);
    }
    else if (this.props.type === "floatlist") {
      value = [];
      var values = event.target.value.split(",");
      console.log("---split", values)
      for (var i = 0; i < values.length; i++) {
        value.push(parseFloat(values[i]));
      }
      console.log("string to array", value)
    }
    else {
      value = event.target.value;
    }
    this.newValue = value;
    this.debounceChange();
    //this.props.onChange({ id: this.props.id, value: value });
    this.setState({ value: value });
  }

  render() {
    var type;
    var value;
    if (["int", "float"].includes(this.props.type)) {
      type = "number";
      value = this.state.value;
    }
    else if (this.props.type === "floatlist") {
      type = "text";
      value = this.state.value.join(", ");
      console.log("array to string", value)
    }
    else {
      type = this.props.type;
      value = this.state.value;
    }
    return (
      <div className="row">
        <div className="column left">
          {this.props.desc}
        </div>
        <div className="column left">
          <input type={type} value={value} onChange={this.handleChange} />
        </div>
      </div>
    );
  }
}


export class ParameterInput extends React.Component {
  constructor(props) {
    super(props);
    this.state = this.props.parameters;
  }

  handleChange = (event) => {
    //event.preventDefault();
    console.log("parameterinput", event)
    var id = event.id;
    console.log("change", id);
    this.setState(state => {
      console.log("state before", state);
      var parameters = Object.assign({}, state);
      parameters[id] = event.value;
      console.log("state after", parameters);
      this.props.onChange(parameters);
      return (parameters);
    });
  };

  special_types = {
    "Conv": {
      "format": { type: "enum", desc: "format", subtype: "coeffformat" },
    }
  }

  type_dict = {
    "a": { type: "floatlist", desc: "a" },
    "adjust_period": { type: "int", desc: "adjust_period" },
    "amplitude": { type: "float", desc: "amplitude" },
    "b": { type: "floatlist", desc: "b" },
    "bits": { type: "int", desc: "bits" },
    "capture_samplerate": { type: "int", desc: "capture_samplerate" },
    "channel": { type: "int", desc: "channel" },
    "channels": { type: "int", desc: "channels" },
    "chunksize": { type: "int", desc: "chunksize" },
    "delay": { type: "float", desc: "delay" },
    "dest": { type: "int", desc: "dest" },
    "device": { type: "text", desc: "device" },
    "enable_rate_adjust": { type: "bool", desc: "enable_rate_adjust" },
    "enable_resampling": { type: "bool", desc: "enable_resampling" },
    "extra_samples": { type: "int", desc: "extra_samples" },
    "file": { type: "text", desc: "file" },
    "filename": { type: "text", desc: "filename" },
    "format": { type: "enum", desc: "format", subtype: "sampleformat" },
    "freq": { type: "float", desc: "freq" },
    "gain": { type: "float", desc: "gain" },
    "in": { type: "int", desc: "in" },
    "inverted": { type: "bool", desc: "inverted" },
    "order": { type: "int", desc: "order" },
    "out": { type: "int", desc: "out" },
    "q": { type: "float", desc: "Q" },
    "queuelimit": { type: "int", desc: "queuelimit" },
    "read_bytes": { type: "int", desc: "read_bytes" },
    "read_bytes_lines": { type: "int", desc: "read_bytes_lines" },
    "samplerate": { type: "int", desc: "samplerate" },
    "silence_threshold": { type: "float", desc: "silence_threshold" },
    "silence_timeout": { type: "float", desc: "silence_timeout" },
    "skip_bytes": { type: "int", desc: "skip_bytes" },
    "skip_bytes_lines": { type: "int", desc: "skip_bytes_lines" },
    "slope": { type: "float", desc: "slope" },
    "target_level": { type: "int", desc: "target_level" },
    "unit": { type: "enum", desc: "unit", subtype: "delayunit" },
    "values": { type: "floatlist", desc: "values" },
  };

  get_input(par, value) {
    var pars;
    if (this.special_types.hasOwnProperty(this.props.context)) {
      if (this.special_types[this.props.context].hasOwnProperty(par)) {
        pars = this.special_types[this.props.context][par];
      }
      else {
        pars = this.type_dict[par];
      }
    }
    else {
      pars = this.type_dict[par];
    }
    if (pars) {
      if (pars.type === "bool") {
        return <BoolSelect key={par} desc={pars.desc} id={par} value={value} onChange={this.handleChange} />;
      }
      else if (pars.type === "enum") {
        return <EnumSelect key={par} desc={pars.desc} type={pars.subtype} value={value} onSelect={this.handleChange} />;
      }
      else {
        return <InputField key={par} desc={pars.desc} id={par} type={pars.type} value={value} onChange={this.handleChange} />;
      }
    }
  }

  render() {
    console.log("ParameterInput", this.props.parameters)
    var fields = Object.keys(this.props.parameters).map(
      (val, i) => {
        var input = this.get_input(val, this.props.parameters[val]);
        return (
          input
        )
      }
    )
    return (
      <div className="parameterinput">
        {fields}
      </div>
    );
  }
}


export class ControlledPopup extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: props.open, image: props.image };
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
  }
  openModal() {
    this.setState({ open: true });
  }

  closeModal() {
    this.setState({ open: false });
    this.props.onClose(this.props.id);
  }

  render() {
    var url;
    if (this.state.image) {
      url = URL.createObjectURL(this.props.image);
    }
    return (
      <div>
        <Popup
          open={this.state.open}
          closeOnDocumentClick
          onClose={this.closeModal}
        >
          <div className="modal">
            <span className="close" onClick={this.closeModal}>
              ✖
            </span>
            <div>
              <img src={url} alt="graph" width="100%" height="100%" />
            </div>
          </div>
        </Popup>
      </div>
    );
  }
}