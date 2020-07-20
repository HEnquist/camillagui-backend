import React from 'react';
import './index.css';
import { ParameterInput, InputField } from './common.js';




class MixerMapping extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleChange = this.handleChange.bind(this);
  }

  template = { channel: 0, gain: 0, inverted: false };

  handleChange(event) {
    console.log("field:", event.target.value);
    this.props.onChange({ id: this.props.id, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  addSource = (event) => {
    console.log("Add a source")
    this.setState(prevState => {
      prevState.config.sources.push(this.template);
      return prevState;
    })
  }

  render() {
    var fields = this.state.config.sources.map(
      (source, idx) => {
        return (
          <div key={idx} className="mixersource">
            <MixerSource config={source} />
            <div><button onClick={this.removeFilter}>✖</button></div>
          </div>
        )
      }
    )
    return (
      <div className="mixermapping">
        <ParameterInput parameters={this.state.config} onChange={this.handleChange} />
        <div>Sources</div>
        {fields}
        <div><button onClick={this.addSource}>+</button></div>
      </div>

    );
  }
}



class MixerSource extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    console.log("field:", event.target.value);
    this.props.onChange({ id: this.props.id, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  render() {
    return (
      <div>
        <ParameterInput parameters={this.state.config} onChange={this.handleChange} />
      </div>
    );
  }
}

class Mixer extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    console.log("field:", event.target.value);
    this.props.onChange({ id: this.props.id, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  template = { 
    dest: 0, 
    sources: [
      { channel: 0, gain: 0, inverted: false }
    ] 
  }

  addMapping = (event) => {
    console.log("Add a mapping")
    this.setState(prevState => {
      prevState.config.mapping.push(this.template);
      return prevState;
    })
  }

  render() {
    var fields = this.state.config.mapping.map(
      (mapping, idx) => {
        return (
          <div key={idx}>
            <MixerMapping config={mapping} />
          </div>
        )
      }
    )
    return (
      <div className="mixer">
        <div>Channels</div>
        <ParameterInput parameters={this.state.config.channels} onChange={this.handleChannels} />
        <div>Mapping</div>
        <div className="mappings">
        {fields}
        <div><button onClick={this.addMapping}>+</button></div>
        </div>
      </div>
    );
  }
}



export class MixerList extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = { nbr: 2, mixers: { test1: { channels: { in: 2, out: 4 }, mapping: [{ dest: 0, sources: [{ channel: 0, gain: 0, inverted: false }] }] } } };
    //this.state = {filters: {}, nbr: 0};
  }

  template = {
    channels: { in: 2, out: 4 },
    mapping: [
      {
        dest: 0, sources: [
          { channel: 0, gain: 0, inverted: false }
        ]
      }
    ]
  }

  handleFilterUpdate = (mixValue) => {
    console.log("MixerList got:", mixValue)
    this.setState(prevState => {
      prevState.mixers[mixValue.name] = { type: mixValue.type, parameters: mixValue.parameters };
      return prevState;
    })
  }

  updateName = (event) => {
    console.log("new name:", event);
    this.setState(prevState => {
      var mixers = prevState.mixers;
      delete Object.assign(mixers, { [event.value]: mixers[event.id] })[event.id];
      //this.setState({value: value});
      return prevState;
    })
  }

  handleChange(params) {
    this.setState(prevState => {
      console.log("mixers got:", params)
      var state = Object.assign({}, prevState);
      state.config = params;
      console.log("mixers new:", state)
      this.props.onChange(state.config);
      return state;
    })
  }

  addMixer = (event) => {
    //event.preventDefault();
    this.setState(state => {
      const nbr = state.nbr + 1;
      const newname = "new" + nbr.toString();
      const mixers = Object.assign({}, state.mixers, { [newname]: this.template });
      console.log(mixers);
      return {
        mixers,
        nbr,
      };
    });
  }

  removeMixer = (event) => {
    var i = event.target.id;
    console.log("delete", i);
    this.setState(state => {
      const nbr = state.nbr;
      const mixers = Object.assign({}, state.mixers);
      delete mixers[i];
      console.log(mixers);
      return {
        mixers,
        nbr,
      };
    });
  };

  render() {
    console.log("render:", this.state);
    return (
      <div>
        <div className="desc">Mixers</div>
        <div className="mixers">
          {
            Object.keys(this.state.mixers).map(
              (mix, i) => {
                return (
                  <div key={mix} className="mixer">
                    <table><tbody>
                      <InputField key={mix} id={mix} desc="Name" type="text" value={mix} onChange={this.updateName} />
                    </tbody></table>
                    <div>
                      <Mixer config={this.state.mixers[mix]} name={mix} onChange={this.handleMixerUpdate} />
                    </div>
                    <div>
                      <button onClick={this.removeMixer} id={mix}>✖</button>
                    </div>
                  </div>
                )
              }
            )
          }
          <button onClick={this.addMixer}>+</button>
        </div>
      </div>
    );
  }
}




// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
