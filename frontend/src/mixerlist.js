import React from 'react';
import './index.css';
import { ParameterInput, InputField, EnumSelect} from './common.js';




class MixerMapping extends React.Component {
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
    var fields = this.state.config.sources.map(
      (source) => {
        return (
          <div className="mixersource">
          <MixerSource config={source} />
          <div><button onClick={this.removeFilter}>✖</button></div>
          </div>
        )
      }
    )
    return (
      <div className="mixermapping">
        <ParameterInput parameters={this.state.config} onChange={this.handleChange}/>
        <div>Sources</div>
        {fields}
        <div><button onClick={this.addFilter}>+</button></div>
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
        <ParameterInput parameters={this.state.config} onChange={this.handleChange}/>
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
  
    render() {
      var fields = this.state.config.mapping.map(
        (mapping) => {
          return (
            <div>
            <MixerMapping config={mapping} />
            </div>
          )
        }
      )
      return (
        <div className="mixer">
            <div>Channels</div>
          <ParameterInput parameters={this.state.config.channels} onChange={this.handleChannels}/>
          <div>Mapping</div>
          {fields}
        </div>
      );
    }
  }



export class MixerList extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = {mixers: {test1: {channels: {in: 2, out: 4}, mapping: [{dest: 0, sources: [{channel: 0, gain: 0, inverted: false}]}]}}};
    //this.state = {filters: {}, nbr: 0};
  }

  handleFilterUpdate = (filtValue) => {
    console.log("FilterList got:", filtValue)
    this.setState(prevState => {
      prevState.filters[filtValue.name] = {type: filtValue.type, parameters: filtValue.parameters};
      return prevState;
    })
  }

  updateName = (event) => {
    console.log("new name:", event);
    this.setState(prevState => {
      var filters = prevState.filters;
      delete Object.assign(filters, {[event.value]: filters[event.id] })[event.id];
      //this.setState({value: value});
      return prevState;
    })
  }

  handleChange(params) {
    this.setState(prevState => {
      console.log("filters got:", params)
      var state = Object.assign({}, prevState);
      state.config = params;
      console.log("filters new:", state)
      this.props.onChange(state.config);
      return state;
    })
  }

  addMixer = (event) => {
    //event.preventDefault();
    this.setState(state => {
      const nbr = state.nbr + 1;
      const newname = "new"+nbr.toString();
      const filters = Object.assign({}, state.filters, {[newname]: {"type": "Biquad", "parameters": {"type": "Lowpass", "q": 0.5, "freq": 1000}}});
      console.log(filters);
      return {
        filters,
        nbr,
      };
    });
  }

  removeMixer = (event) => {
    var i = event.target.id;
    console.log("delete", i);
    this.setState(state => {
      const nbr = state.nbr;
      const filters = Object.assign({}, state.filters);
      delete filters[i];
      console.log(filters);
      return {
        filters,
        nbr,
      };
    });
  };

  render() {
    console.log("render:", this.state);
    return (
      <div>
        <div className="desc">Mixers</div>
        {
          Object.keys(this.state.mixers).map(
            (mix, i) => {   
              return (
                <div key={mix} className="listitem">
                  <div><InputField key={mix} id={mix} desc="Name" type="text" value={mix} onChange={this.updateName}/></div>
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
    );
  }
}




// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
