import React from 'react';
import './index.css';


export class BoolSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onSelect(event.target.value);
  }

  render() {
    return (
      <div>
        {this.props.desc}:
        <select name="truefalse" id="truefalse" onChange={this.handleChange}>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>
    );
  }
}

export class FormatSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onSelect(event.target.value);
  }

  render() {
    return (
      <div>
        {this.props.desc}:
        <select name="format" id="format" onChange={this.handleChange}>
          <option value="s16le">S16LE</option>
          <option value="s24le">S24LE</option>
          <option value="s24le3">S24LE3</option>
          <option value="s32le">S32LE</option>
          <option value="float32le">FLOAT32LE</option>
          <option value="float64le">FLOAT64LE</option>
        </select>
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
  }

  //handleChange(event) {
  //  this.setState(_prevState => {
  //    //console.log("field:", event.target.value)
  //    //this.props.onChange(event.target.value);
  //    return { value: event.target.value }
  //  })
  //}
  handleChange(event) {
    console.log("field:", event.target.value);
    this.props.onChange({ id: this.props.id, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  render() {
    return (
      <label>
        {this.props.desc}:
        <input type={this.props.type} value={this.state.value} onChange={this.handleChange} />
      </label>
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
      return {
        parameters
      };
    });
  };

  type_dict = {
    "q": { type: "number", desc: "Q" },
    "freq": { type: "number", desc: "freq" },
    "slope": { type: "number", desc: "slope" },
    "file": { type: "text", desc: "file" },
    "device": { type: "text", desc: "device" },
    "channels": { type: "number", desc: "channels" },
    "samplerate": { type: "number", desc: "sampelrate" },
    "read_bytes": { type: "number", desc: "read_bytes" },
    "extra_samples": { type: "number", desc: "extra_samples" },
    "skip_bytes": { type: "number", desc: "skip_bytes" },
    "target_level": { type: "number", desc: "target_level" },
    "adjust_period": { type: "number", desc: "adjust_period" },
    "chunksize": { type: "number", desc: "chunksize" },
    "capture_samplerate": { type: "number", desc: "capture_samplerate" },
    "enable_resampling": { type: "bool", desc: "enable_resampling" },
  };

  get_input(par, value) {
    var pars = this.type_dict[par];
    if (pars) {
      if (pars.type == "bool") {
        return <div key={par}><BoolSelect desc={pars.desc} id={par} value={value} onChange={this.handleChange} /></div>;
      }
      else {
        return <div key={par}><InputField desc={pars.desc} id={par} type={pars.type} value={value} onChange={this.handleChange} /></div>;
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
      <div>
        {fields}
      </div>
    );
  }
}