import React from 'react';
import './index.css';


export class BoolSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onChange({id: this.props.id, value: event.target.checked});
  }

  render() {
    return (
      <tr className="formrow">
        <td>
        {this.props.desc}
        </td>
        <td>
        <input type="checkbox" name={this.props.id}  id={this.props.id} onChange={this.handleChange}></input>
        </td>
      </tr>
    );
  }
}


export class EnumSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  enums = {
    "filter": ["Biquad", "BiquadGroup", "Conv", "Delay", "Gain", "Dither", "DiffEq"],
    "Biquad": ["Lowpass", "Highpass", "Highshelf", "Lowshelf","LowpassFO", "HighpassFO", "HighshelfFO", "LowshelfFO"],
    "BiquadGroup": ["ButterworthHighpass", "ButterworthLowpass", "LinkwitzRileyHighpass", "LinkwitzRileyLowpass"],
    "coeffformat": ["S16LE", "S24LE", "S24LE3", "S32LE", "FLOAT32LE", "FLOAT64LE", "TEXT"],
    "sampleformat": ["S16LE", "S24LE", "S24LE3", "S32LE", "FLOAT32LE", "FLOAT64LE"],
    "resampler": ["FastAsync", "BalancedAsync", "AccurateAsync", "Synchronous"],
    "delayunit": ["ms", "samples"],
    "Conv": ["File", "Values"],
    "backend": ["Alsa", "PulseAudio", "Wasapi", "CoreAudio", "File"],
    "Dither": ["Simple", "Uniform", "Lipshitz441", "Fweighted441", "Shibata441", "Shibata48", "None"]
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
      <tr className="formrow">
        <td>
        {this.props.desc}
        </td>
        <td>
        <select name={this.props.desc} id={this.props.desc} onChange={this.handleChange}>
          {fields}
        </select>
        </td>
      </tr>
    );
  }
}

export class InputField extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { value: this.props.value };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    console.log("field:", event.target.value);
    this.props.onChange({ id: this.props.id, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  render() {
    return (
      <tr className="formrow">
        <td>{this.props.desc}</td>
        <td><input type={this.props.type} value={this.state.value} onChange={this.handleChange} /></td>
      </tr>
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

  type_dict = {
    "q": { type: "number", desc: "Q" },
    "freq": { type: "number", desc: "freq" },
    "slope": { type: "number", desc: "slope" },
    "file": { type: "text", desc: "file" },
    "device": { type: "text", desc: "device" },
    "channels": { type: "number", desc: "channels" },
    "samplerate": { type: "number", desc: "samplerate" },
    "read_bytes": { type: "number", desc: "read_bytes" },
    "extra_samples": { type: "number", desc: "extra_samples" },
    "skip_bytes": { type: "number", desc: "skip_bytes" },
    "target_level": { type: "number", desc: "target_level" },
    "adjust_period": { type: "number", desc: "adjust_period" },
    "chunksize": { type: "number", desc: "chunksize" },
    "capture_samplerate": { type: "number", desc: "capture_samplerate" },
    "enable_resampling": { type: "bool", desc: "enable_resampling" },
    "format": { type: "enum", desc: "format", subtype: "sampleformat" },
    "order": { type: "number", desc: "order" },
    "gain": { type: "number", desc: "gain" },
    "inverted": { type: "bool", desc: "inverted" },
    "unit": { type: "enum", desc: "unit", subtype: "delayunit" },
    "values": { type: "text", desc: "values" },
    "filename": { type: "text", desc: "filename" },
    "skip_bytes_lines": { type: "number", desc: "skip_bytes_lines" },
    "read_bytes_lines": { type: "number", desc: "read_bytes_lines" },
    "bits": { type: "number", desc: "bits" },
    "amplitude": { type: "number", desc: "amplitude" },
    "delay": { type: "number", desc: "delay" },
    "a": { type: "text", desc: "a" },
    "b": { type: "text", desc: "b" },
    "queuelimit": { type: "number", desc: "queuelimit" },
    "silence_threshold": { type: "number", desc: "silence_threshold" },
    "silence_timeout": { type: "number", desc: "silence_timeout" },
    "in": { type: "number", desc: "in" },
    "out": { type: "number", desc: "out" },
    "dest": { type: "number", desc: "dest" },
    "channel": { type: "number", desc: "channel" },
  };

  get_input(par, value) {
    var pars = this.type_dict[par];
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
      <table className="parameterinput">
        <tbody>
        {fields}
        </tbody>
      </table>
    );
  }
}