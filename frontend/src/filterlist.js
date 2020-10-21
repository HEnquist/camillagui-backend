import React from "react";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import "./index.css";
import {
  ParameterInput,
  InputField,
  EnumSelect,
  ChartPopup,
  ListSelectPopup,
} from "./common.js";
import { FLASKURL } from "./index.tsx";

class FilterParams extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.handleCloseList = this.handleCloseList.bind(this);
    this.handlePickFile = this.handlePickFile.bind(this);
    this.pickCoeff = this.pickCoeff.bind(this);
    this.state = {
      parameters: cloneDeep(this.props.parameters),
      listpopup: false,
      listitems: {},
    };
    console.log(this.state);
  }

  componentDidUpdate(prevProps) {
    if (!isEqual(this.props.parameters, this.state.parameters)) {
      this.setState({ parameters: cloneDeep(this.props.parameters) });
    }
  }

  handleChange(parameters) {
    this.setState((prevState) => {
      const state = Object.assign({}, prevState);
      state.parameters = parameters;
      this.props.onChange(parameters);
      return state;
    });
  }

  templates = {
    Biquad: {
      Lowpass: { type: "Lowpass", q: 0.5, freq: 1000 },
      Highpass: { type: "Highpass", q: 0.5, freq: 1000 },
      Lowshelf: { type: "Lowshelf", gain: 6, slope: 6, freq: 1000 },
      Highshelf: { type: "Highshelf", gain: 6, slope: 6, freq: 1000 },
      LowpassFO: { type: "LowpassFO", freq: 1000 },
      HighpassFO: { type: "HighpassFO", freq: 1000 },
      LowshelfFO: { type: "LowshelfFO", gain: 6, freq: 1000 },
      HighshelfFO: { type: "HighshelfFO", gain: 6, freq: 1000 },
      Peaking: { type: "Peaking", gain: 6, q: 1.5, freq: 1000 },
      Notch: { type: "Notch", q: 1.5, freq: 1000 },
      Allpass: { type: "Allpass", q: 0.5, freq: 1000 },
      AllpassFO: { type: "AllpassFO", freq: 1000 },
      LinkwitzTransform: {
        type: "LinkwitzTransform",
        q_act: 1.5,
        q_target: 0.5,
        freq_act: 50,
        freq_target: 25,
      },
      Free: { type: "Free", a1: 0.0, a2: 0.0, b0: -1.0, b1: 1.0, b2: 0.0 },
    },
    BiquadCombo: {
      ButterworthLowpass: { type: "ButterworthLowpass", order: 2, freq: 1000 },
      ButterworthHighpass: {
        type: "ButterworthHighpass",
        order: 2,
        freq: 1000,
      },
      LinkwitzRileyLowpass: {
        type: "LinkwitzRileyLowpass",
        order: 2,
        freq: 1000,
      },
      LinkwitzRileyHighpass: {
        type: "LinkwitzRileyHighpass",
        order: 2,
        freq: 1000,
      },
    },
    Conv: {
      File: {
        type: "File",
        filename: "",
        format: "TEXT",
        skip_bytes_lines: 0,
        read_bytes_lines: 0,
      },
      Values: { type: "Values", values: [1.0, 0.0, 0.0, 0.0], length: 0 },
    },
    Delay: {
      Default: { delay: 0.0, unit: "ms" },
    },
    Gain: {
      Default: { gain: 0.0, inverted: false },
    },
    DiffEq: {
      Default: { a: [1.0, 0.0], b: [1.0, 0.0] },
    },
    Dither: {
      Simple: { type: "Simple", bits: 16 },
      Uniform: { type: "Uniform", bits: 16, amplitude: 1.0 },
      Lipshitz441: { type: "Lipshitz441", bits: 16 },
      Fweighted441: { type: "Fweighted441", bits: 16 },
      Shibata441: { type: "Shibata441", bits: 16 },
      Shibata48: { type: "Shibata48", bits: 16 },
      None: { type: "None", bits: 16 },
    },
  };

  handleSelect = (selectValue) => {
    this.setState((prevState) => {
      const template = cloneDeep(this.templates[this.props.type][selectValue]);
      const state = { parameters: template };
      this.props.onChange(state.parameters);
      return state;
    });
  };

  handleCloseList() {
    this.setState((state) => {
      return { listpopup: false };
    });
  }

  handlePickFile(value) {
    console.log(value);
    this.setState((state) => {
      if (state.parameters.type === "File") {
        state.parameters.filename = state.listitems[value];
      }
      return { parameters: state.parameters };
    });
  }

  pickCoeff(event) {
    console.log("Open coeff list");
    fetch(FLASKURL + "/api/storedcoeffs", {
      method: "GET", // *GET, POST, PUT, DELETE, etc.
      mode: "same-origin", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    }).then(
      (result) => {
        result.json().then((data) => {
          this.setState((state) => {
            return { listitems: data, listpopup: true };
          });
        });
        console.log("OK", result);
      },
      (error) => {
        console.log("Failed", error);
      }
    );
  }

  render() {
    console.log("--FilterParams, type:", this.props.type);
    var filterselect;
    filterselect = (
      <ParameterInput
        parameters={this.state.parameters}
        context={this.props.type}
        onChange={this.handleChange}
      />
    );
    return (
      <div>
        <div className="row">
          <EnumSelect
            desc="subtype"
            data-tip="Filter subtype"
            type={this.props.type}
            value={this.state.parameters.type}
            onSelect={this.handleSelect}
          />
        </div>
        <div>{filterselect}</div>
        <button data-tip="Pick coefficent file" onClick={this.pickCoeff}>
          ...
        </button>
        <ListSelectPopup
          key={this.state.listpopup}
          open={this.state.listpopup}
          items={this.state.listitems}
          onClose={this.handleCloseList}
          onSelect={this.handlePickFile}
        />
      </div>
    );
  }
}

class Filter extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { type: this.props.type, parameters: cloneDeep(this.props.parameters) };
    //this.state = {value: "biquad"};
  }

  templates = {
    Biquad: { type: "Lowpass", q: 0.5, freq: 1000 },
    BiquadCombo: { type: "ButterworthHighpass", order: 2, freq: 1000 },
    Conv: {
      type: "File",
      filename: "",
      format: "TEXT",
      read_bytes_lines: 0,
      skip_bytes_lines: 0,
    },
    Delay: { delay: 0.0, unit: "ms" },
    Gain: { gain: 0.0, inverted: false },
    DiffEq: { a: [1.0, 0.0], b: [1.0, 0.0] },
    Dither: { type: "Simple", bits: 16 },
  };

  componentDidUpdate() {
    if (!isEqual(this.props.parameters, this.state.parameters)) {
      this.setState({ parameters: cloneDeep(this.props.parameters) });
    }
  }

  handleChange(event) {
    this.setState({ value: event.target.value });
  }

  handleFilterSelect = (filtValue) => {
    this.setState((prevState) => {
      const state = Object.assign({}, prevState);
      state.parameters = cloneDeep(this.templates[filtValue]);
      state.type = filtValue;
      this.props.onFilter({
        name: this.props.name,
        type: state.type,
        parameters: state.parameters,
      });
      console.log("--==Filter", state);
      return state;
    });
  };

  handleModifyFilter = (filtParams) => {
    console.log("handleModifyFilter", filtParams);
    this.setState((prevState) => {
      //const state = Object.assign({}, prevState);
      prevState.parameters = filtParams;
      this.props.onFilter({
        name: this.props.name,
        type: prevState.type,
        parameters: filtParams,
      });
      console.log("--==--Filter", prevState);
      return prevState;
    });
  };

  render() {
    console.log("--Filter, state:", this.state);
    return (
      <div className="row">
        <div className="row">
          <EnumSelect
            desc="type"
            type="filter"
            data-tip="Filter type"
            value={this.state.type}
            onSelect={this.handleFilterSelect}
          />
        </div>
        <div className="row">
          <FilterParams
            type={this.state.type}
            parameters={this.state.parameters}
            onChange={this.handleModifyFilter}
          />
        </div>
      </div>
    );
  }
}

export class FilterList extends React.Component {
  constructor(props) {
    super(props);
    //this.handleChange = this.handleChange.bind(this);
    this.state = { filters: props.config, samplerate: props.samplerate, nbr: 2, popup: false, data: {name:""} };
  }

  componentDidUpdate() {
    if (!isEqual(this.props.config, this.state.filters)) {
      this.setState({ filters: cloneDeep(this.props.config) });
    }
    if (!isEqual(this.props.samplerate, this.state.samplerate)) {
      this.setState({ samplerate: this.props.samplerate });
    }
  }

  handleFilterUpdate = (filtValue) => {
    console.log("FilterList got:", filtValue);
    this.setState((prevState) => {
      prevState.filters[filtValue.name] = {
        type: filtValue.type,
        parameters: filtValue.parameters,
      };
      this.props.onChange(prevState.filters);
      return prevState;
    });
  };

  updateName = (event) => {
    console.log("new name:", event.id, event.value);
    this.setState((prevState) => {
      var filters = prevState.filters;
      delete Object.assign(filters, { [event.value]: filters[event.id] })[
        event.id
      ];
      this.props.onChange(prevState.filters);
      return prevState;
    });
  };

  handleChange(params) {
    this.setState((prevState) => {
      console.log("filters got:", params);
      var state = Object.assign({}, prevState);
      state.config = params;
      console.log("filters new:", state);
      this.props.onChange(state.filters);
      return state;
    });
  }

  getNewName(state) {
    var nbr = 1;
    while (Object.keys(state.filters).includes("new" + nbr.toString())) {
      nbr = nbr + 1;
    }
    const newname = "new" + nbr.toString();
    return newname;
  }

  addFilter = (event) => {
    //event.preventDefault();
    this.setState((state) => {
      const newname = this.getNewName(state);
      const filters = Object.assign({}, state.filters, {
        [newname]: {
          type: "Biquad",
          parameters: { type: "Lowpass", q: 0.5, freq: 1000 },
        },
      });
      console.log(filters);
      this.props.onChange(filters);
      return {
        filters,
      };
    });
  };

  removeFilter = (event) => {
    var i = event.target.id;
    console.log("delete", i);
    this.setState((state) => {
      const filters = Object.assign({}, state.filters);
      delete filters[i];
      console.log(filters);
      this.props.onChange(filters);
      return {
        filters,
      };
    });
  };

  plotFilter = (event) => {
    var i = event.target.id;
    console.log("PLot!!!", i);
    var filter;
    console.log(filter);
    fetch(FLASKURL + "/api/evalfilter", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: "same-origin", // no-cors, *cors, same-origin
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify({
        name: i,
        config: this.state.filters[i],
        samplerate: this.state.samplerate,
      }), // body data type must match "Content-Type" header
    }).then(
      (result) => {
        result.json().then((data) => {
          this.setState((state) => {
            return { popup: true, data: data };
          });
        });
        console.log("OK", result);
      },
      (error) => {
        console.log("Failed", error);
      }
    );
  };

  handleClose = () => {
    this.setState((state) => {
      return { popup: false };
    });
  };

  render() {
    console.log("render:", this.state);
    return (
      <div>
        <div className="filters">
          {Object.keys(this.state.filters).map((filt, i) => {
            return (
              <div key={filt} className="filter">
                <div className="row">
                  <InputField
                    key={filt}
                    id={filt}
                    data-tip="Filter name, must be unique"
                    desc="Name"
                    type="text"
                    value={filt}
                    onChange={this.updateName}
                  />
                </div>
                <div className="filterparams">
                  <Filter
                    type={this.state.filters[filt].type}
                    parameters={this.state.filters[filt].parameters}
                    name={filt}
                    onFilter={this.handleFilterUpdate}
                  />
                </div>
                <div>
                  <button
                    className="deletebutton"
                    data-tip="Delete this filter"
                    onClick={this.removeFilter}
                    id={filt}
                  >
                    ✖
                  </button>
                  <button
                    className="plotbutton"
                    data-tip="Plot frequency response of this filter"
                    onClick={this.plotFilter}
                    id={filt}
                  >
                    Plot
                  </button>
                </div>
              </div>
            );
          })}
          <button
            className="addbutton"
            data-tip="Add a new filter"
            onClick={this.addFilter}
          >
            +
          </button>
          <ChartPopup
            key={this.state.popup}
            open={this.state.popup}
            data={this.state.data}
            onClose={this.handleClose}
          />
        </div>
      </div>
    );
  }
}

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
