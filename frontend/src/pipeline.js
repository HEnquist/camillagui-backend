import React from 'react';
import './index.css';
//import { ParameterInput, InputField } from './common.js';
import { ParameterInput, EnumSelect, ControlledPopup } from './common.js';
import cloneDeep from 'lodash/cloneDeep';
import { FLASKURL } from './index.tsx'


export class NameSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { value: this.props.value };
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onChange({ idx: this.props.idx, value: event.target.value });
  }

  deleteName = () => {
    this.props.onDelete(this.props.idx)
  }

  render() {
    var vals = this.props.allnames;
    if (!vals) {
      return "";
    }
    var options = vals.map(
      (val) => {
        return (
          <option key={val} value={val}>{val}</option>
        )
      }
    )
    var button;
    if (this.props.show_button) {
      button = <div className="column right">
        <button className="deletebutton" data-tip="Remove this item from the list" onClick={this.deleteName}>✖</button>
      </div>;
    }
    return (
      <div className="row">
        <div className="column left">
          <select name={this.props.desc} id={this.props.desc} value={this.state.value} data-tip="Name of the item" onChange={this.handleChange}>
            {options}
          </select>
        </div>
        {button}
      </div>
    );
  }
}

export class MixerStep extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { name: this.props.name };
  }

  handleChange(event) {
    console.log("change name", event)
    this.setState(prevState => {
      prevState.value = event.value;
      this.props.onChange(prevState.value);
      return prevState;
    })
  }

  render() {
    return (
      <NameSelect value={this.state.name} allnames={this.props.allnames} onChange={this.handleChange} />
    );
  }
}


export class FilterStep extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = { config: this.props.config };
  }

  handleChange = (event) => {
    console.log("new names", event)
    this.setState(state => {
      state.config.names = event;
      this.props.onChange({ idx: this.props.idx, value: state.config });
      return state;
    });
  }

  handleParChange = (event) => {
    this.setState(state => {
      state.config.channel = event.channel;
      this.props.onChange({ idx: this.props.idx, value: state.config });
      return state;
    });
  }

  render() {
    return (
      <div className="pipelinestep">
        <ParameterInput parameters={this.state.config} onChange={this.handleParChange} />
        <div>Names</div>
        <NameList names={this.state.config.names} allnames={this.props.allnames} onChange={this.handleChange} />
      </div >
    );
  }
}


// ---------------  NameList ---------------------------------------------
class NameList extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { names: this.props.names };
    //this.handleChange = this.handleChange.bind(this);
  }

  addName = () => {
    //event.preventDefault();
    this.setState(state => {
      state.names.push(cloneDeep(this.props.allnames[0]))
      this.props.onChange(state.names);
      return state;
    });
  }

  deleteName = (idx) => {
    console.log("Delete a name", idx)
    this.setState(prevState => {
      prevState.names.splice(idx, 1);
      this.props.onChange(prevState.names);
      return prevState;
    })
  }

  handleChange = (event) => {
    console.log("change name", event)
    this.setState(prevState => {
      prevState.names[event.idx] = event.value;
      this.props.onChange(prevState.names);
      return prevState;
    })
  }

  render() {
    var names = this.state.names.map(
      (name, idx) => {
        return (
          <NameSelect key={name + "_" + idx.toString()} idx={idx} name={name} value={name} allnames={this.props.allnames} onChange={this.handleChange} onDelete={this.deleteName} show_button={true} />
        )
      }
    )
    return (
      <div className="namelist">
        {names}
        <div><button className="addbutton" data-tip="Add a filter to the list" onClick={this.addName}>+</button></div>
      </div>
    );
  }
}

// ---------------  PipelineStep ---------------------------------------------
class PipelineStep extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { config: this.props.config };
    this.handleSelect = this.handleSelect.bind(this);
  }

  templates = {
    "Mixer": {
      type: "Mixer",
      name: "",
    },
    "Filter": {
      type: "Filter",
      channel: 0,
      names: [],
    }
  }

  handleMixerChange = (mixer) => {
    console.log("handleMixerChange", mixer)
    this.setState(prevState => {
      prevState.config.name = mixer;
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  handleFilterChange = (filter) => {
    console.log("handleFilterChange", filter)
    this.setState(prevState => {
      prevState.config = filter.value;
      //this.props.onChange(filter);
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  handleSelect(event) {
    console.log("change step type", event)
    this.setState(prevState => {
      var templ = cloneDeep(this.templates[event])
      prevState.config = templ;
      this.props.onChange({ idx: this.props.idx, value: prevState.config });
      return prevState;
    })
  }

  render() {
    var fields;
    if (this.state.config.type === "Mixer") {
      fields =
        <div className="row">
          <MixerStep key={this.props.idx.toString() + JSON.stringify(this.state.config)} idx={this.props.idx} name={this.state.config.name} allnames={this.props.mixers} onChange={this.handleMixerChange} />
        </div>;
    }
    else {
      fields =
        <div className="row">
          <FilterStep key={this.props.idx.toString() + JSON.stringify(this.state.config)} idx={this.props.idx} config={this.state.config} allnames={this.props.filters} onChange={this.handleFilterChange} />
        </div>;
    }
    return (
      <div>
        <div className="row">
          <EnumSelect desc="type" data-tip="Step type, Mixer or Filter" type="pipelineitem" value={this.state.config.type} onSelect={this.handleSelect} />
        </div>
        {fields}
      </div>
    );
  }
}


// ---------------  Pipeline ---------------------------------------------
export class Pipeline extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = { config: props.config, popup: false, image: null };
    //this.state = {filters: {}, nbr: 0};
  }

  template = {
    type: "Filter",
    channel: 0,
    names: [],
  }

  handleStepUpdate = (mixValue) => {
    console.log("MixerList got:", mixValue)
    this.setState(prevState => {
      prevState.config[mixValue.idx] = mixValue.value;
      this.props.onChange(prevState.config);
      return prevState;
    })
  }

  updateName = (event) => {
    console.log("new name:", event);
    this.setState(prevState => {
      var mixers = prevState.mixers;
      delete Object.assign(mixers, { [event.value]: mixers[event.id] })[event.id];
      this.props.onChange(prevState.config);
      return prevState;
    })
  }

  addStep = () => {
    //event.preventDefault();
    this.setState(state => {
      state.config.push(cloneDeep(this.template))
      this.props.onChange(state.config);
      return state;
    });
  }

  removeStep = (event) => {
    var i = event.target.id;
    console.log("delete", i);
    this.setState(state => {
      state.config.splice(i, 1);
      this.props.onChange(state.config);
      return state;
    });
  };

  plotPipeline = (event) => {
    var i = event.target.id;
    console.log("PLot!!!", i,)
    fetch(FLASKURL + "/api/evalpipeline", {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *cors, same-origin
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify(this.props.getConfig()) // body data type must match "Content-Type" header
    })
      .then(
        (result) => {
          result.blob().then(data => {
            this.setState(state => {
              return { popup: true, image: data }
            });
          })
          console.log("OK", result);
        },
        (error) => {
          console.log("Failed", error);
        }
      )
  }

  handleClose = () => {
    this.setState(state => {
      return { popup: false };
    })
  }

  render() {
    console.log("render:", this.state);
    return (
      <div>
        <div className="desc">Pipeline</div>
        <div className="pipeline">
          {
            this.state.config.map(
              (step, i) => {
                return (
                  <div key={i.toString() + JSON.stringify(step)} className="pipelinestep">
                    <div>
                      <PipelineStep config={step} idx={i} mixers={this.props.mixers} filters={this.props.filters} onChange={this.handleStepUpdate} />
                    </div>
                    <div>
                      <button className="deletebutton" data-tip="Delete this step" onClick={this.removeStep} id={i}>✖</button>
                    </div>
                  </div>
                )
              }
            )
          }
          <button className="addbutton" data-tip="Add a pipeline step" onClick={this.addStep}>+</button>
          <button className="plotbutton" data-tip="Plot the pipeline" onClick={this.plotPipeline} id="plot" >Plot</button>
          <ControlledPopup key={this.state.popup} open={this.state.popup} image={this.state.image} onClose={this.handleClose} />
        </div>
      </div>
    );
  }
}




// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
