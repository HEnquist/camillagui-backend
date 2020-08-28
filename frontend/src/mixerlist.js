import React from 'react';
import './index.css';
import { ParameterInput, InputField } from './common.js';
import cloneDeep from 'lodash/cloneDeep';



// ---------------  MixerMapping ---------------------------------------------
class MixerMapping extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    //this.handleDestChange = this.handleDestChange.bind(this);
  }

  template = { channel: 0, gain: 0, inverted: false };

  handleDestChange = (value) => {
    console.log("MixerMapping::handleDestChange", value);
    this.setState(prevState => {
      prevState.config.dest = value.dest;
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  handleSourceChange = (value) => {
    console.log("value:", value);
    this.setState(prevState => {
      prevState.config.sources[value.idx] = value.value;
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  addSource = (event) => {
    console.log("Add a source")
    this.setState(prevState => {
      prevState.config.sources.push(cloneDeep(this.template));
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  deleteSource = (idx) => {
    console.log("Delete a source", idx)
    this.setState(prevState => {
      prevState.config.sources.splice(idx, 1);
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  render() {
    var fields = this.state.config.sources.map(
      (source, idx) => {
        return (
          <div key={idx.toString()+JSON.stringify(source)} className="mixersource">
            <MixerSource key={idx} idx={idx} config={source} onChange={this.handleSourceChange} />
            <div><button className="deletebutton" data-tip="Delete this source" id={idx} onClick={()=>this.deleteSource(idx)}>✖</button></div>
          </div>
        )
      }
    )
    return (
      <div className="mixermapping">
        <ParameterInput parameters={this.state.config} onChange={this.handleDestChange} />
        <div>Sources</div>
        {fields}
        <div><button className="addbutton" data-tip="Add a source to this mapping" onClick={this.addSource}>+</button></div>
      </div>

    );
  }
}


// ---------------  MixerSource --------------------------------------
class MixerSource extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    console.log("field:", event);
    this.props.onChange({ idx: this.props.idx, value: event });
    this.setState({ config: event });
  }

  render() {
    return (
      <div className="row">
        <ParameterInput parameters={this.state.config} onChange={this.handleChange} />
      </div>
    );
  }
}


// ---------------  Mixer ---------------------------------------------
class Mixer extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    console.log("Mixer::handleChange:", event.target.value);
    this.props.onChange({ name: this.props.name, value: event.target.value });
    this.setState({ value: event.target.value });
  }

  handleChannels = (event) => {
    console.log("Mixer::handleChannels:", event);
    this.setState(prevState => { 
      prevState.config.channels = event;
      this.props.onChange({ name: this.props.name, value: prevState.config });
      return prevState;
    })
  }

  handleMappingChange = (event) => {
    console.log("Mixer::handleMappingChange:", event);
    this.setState(prevState => { 
      prevState.config.mapping[event.idx] = event.value;
      this.props.onChange({ name: this.props.name, value: prevState.config });
      return prevState;
    })
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
      prevState.config.mapping.push(cloneDeep(this.template));
      this.props.onChange({ name: this.props.name, value: prevState.config });
      return prevState;
    })
  }

  deleteMapping = (idx) => {
    console.log("Delete a mapping", idx)
    this.setState(prevState => {
      prevState.config.mapping.splice(idx, 1);
      this.props.onChange({ name: this.props.name, value: prevState.config });
      return prevState;
    })
  }

  render() {
    var fields = this.state.config.mapping.map(
      (mapping, idx) => {
        return (
          <div key={idx}>
            <MixerMapping key={idx.toString()+JSON.stringify(mapping)} idx={idx} config={mapping} onChange={this.handleMappingChange} />
            <div><button className="deletebutton" data-tip="Delete this mapping" id={idx} onClick={()=>this.deleteMapping(idx)}>✖</button></div>
          </div>
        )
      }
    )
    return (
      <div className="mixerparams">
        <div>Channels</div>
        <ParameterInput parameters={this.state.config.channels} onChange={this.handleChannels} />
        <div>Mapping</div>
        <div className="mappings">
        {fields}
        <div><button className="addbutton" data-tip="Add a mapping" onClick={this.addMapping}>+</button></div>
        </div>
      </div>
    );
  }
}


// ---------------  MixerList ---------------------------------------------
export class MixerList extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = { mixers: props.config};
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

  handleMixerUpdate = (mixValue) => {
    console.log("MixerList got:", mixValue)
    this.setState(prevState => {
      prevState.mixers[mixValue.name] = mixValue.value;
      this.props.onChange(prevState.mixers);
      return prevState;
    })
  }

  updateName = (event) => {
    console.log("new name:", event.id, event.value);
    this.setState(prevState => {
      var mixers = prevState.mixers;
      delete Object.assign(mixers, { [event.value]: mixers[event.id] })[event.id];
      this.props.onChange(mixers);
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

  getNewName(state) {
    var nbr=1;
    while (Object.keys(state.mixers).includes("new" + nbr.toString())) {
      nbr = nbr +1;
    }
    const newname = "new" + nbr.toString();
    return newname;
  }

  addMixer = (event) => {
    //event.preventDefault();
    this.setState(state => {
      var newname = this.getNewName(state);
      const mixers = Object.assign({}, state.mixers, { [newname]: cloneDeep(this.template) });
      console.log(mixers);
      this.props.onChange(mixers);
      return {
        mixers,
      };
    });
  }

  removeMixer = (event) => {
    var i = event.target.id;
    console.log("delete", i);
    this.setState(state => {
      const mixers = Object.assign({}, state.mixers);
      delete mixers[i];
      console.log(mixers);
      this.props.onChange(mixers);
      return {
        mixers,
      };
    });
  };

  render() {
    console.log("render:", this.state);
    return (
      <div>
        <div className="mixers">
          {
            Object.keys(this.state.mixers).map(
              (mix, i) => {
                return (
                  <div key={mix} className="mixer">
                    <div className="row">
                      <InputField key={mix} id={mix} desc="Name" type="text" data-tip="Mixer name, must be unique" value={mix} onChange={this.updateName} />
                    </div>
                    <div>
                      <Mixer config={this.state.mixers[mix]} name={mix} onChange={this.handleMixerUpdate} />
                    </div>
                    <div>
                      <button className="deletebutton" data-tip="Delete this mixer" onClick={this.removeMixer} id={mix}>✖</button>
                    </div>
                  </div>
                )
              }
            )
          }
          <button className="addbutton" data-tip="Add a new mixer" onClick={this.addMixer}>+</button>
        </div>
      </div>
    );
  }
}




// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
