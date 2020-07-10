import React from 'react';
import './index.css';


export class FormatSelect extends React.Component {
    constructor(props) {
      super(props);
      this.handleChange = this.handleChange.bind(this);
    }
  
    handleChange(event) {    
      this.setState({value: event.target.value});
      this.props.onSelect(event.target.value);  
    }
  
    render() {
      return (
        <div>
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
      this.state = {value: this.props.value};
      this.handleChange = this.handleChange.bind(this);
    }
  
    handleChange(event) {    
      this.setState({value: event.target.value});  
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
    //constructor(props) {
    //  super(props);
    //}
  
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
  
    render() {
      console.log("ParameterInput", this.props.parameters)
      var fields = Object.keys(this.props.parameters).map(
        (val, i) => {  
          var input;
          switch(val) {
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