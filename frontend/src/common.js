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
    console.log(this.props)
    this.state = { value: this.props.value };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
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
    event.preventDefault();
    var id = event.target.id;
    console.log("change", id);
    this.setState(state => {
      const parameters = Object.assign({}, state.parameters);
      parameters[id] = event.target.value;
      return {
        parameters
      };
    });
  };

  //chunksize: 1024,
  //target_level: 1024,
  //adjust_period: 3,
  //enable_resampling: true,
  //resampler_type: "FastAsync",
  //capture_samplerate":

  render() {
    console.log("ParameterInput", this.props.parameters)
    var fields = Object.keys(this.props.parameters).map(
      (val, i) => {
        var input;
        switch (val) {
          case "q":
            input = <div key={val}><InputField desc="Q" id="q" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "freq":
            input = <div key={val}><InputField desc="freq" id="freq" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "slope":
            input = <div key={val}><InputField desc="slope" id="slope" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "file":
            input = <div key={val}><InputField desc="file" id="file" type="text" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "device":
            input = <div key={val}><InputField desc="device" id="device" type="text" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "channels":
            input = <div key={val}><InputField desc="channels" id="channels" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "samplerate":
            input = <div key={val}><InputField desc="samplerate" id="samplerate" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "chunksize":
            input = <div key={val}><InputField desc="chunksize" id="chunksize" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "target_level":
            input = <div key={val}><InputField desc="target_level" id="target_level" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "adjust_period":
            input = <div key={val}><InputField desc="adjust_period" id="adjust_period" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "capture_samplerate":
            input = <div key={val}><InputField desc="capture_samplerate" id="capture_samplerate" type="number" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          case "enable_resampling":
            input = <div key={val}><BoolSelect desc="enable_resampling" id="enable_resampling" value={this.props.parameters[val]} onChange={this.handleChange} /></div>;
            break;
          default:
            input = null;
        }
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