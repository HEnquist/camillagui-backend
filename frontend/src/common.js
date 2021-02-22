import React from "react";
import "./index.css";
import Popup from "reactjs-popup";
import 'reactjs-popup/dist/index.css';
import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";

export class EnumSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = { value: this.props.value };
  }

  componentDidUpdate(prevProps) {
    if (!isEqual(this.props.value, prevProps.value)) {
      this.setState({ value: this.props.value });
    }
  }

  enums = {
    pipelineitem: ["Mixer", "Filter"],
  };

  handleChange(event) {
    this.setState({ value: event.target.value });
    this.props.onSelect(event.target.value);
  }

  render() {
    var vals = this.enums[this.props.type];
    if (!vals) {
      return "";
    }
    var fields = vals.map((val) => {
      return (
        <option key={val} value={val}>
          {val}
        </option>
      );
    });
    return (
      <div className="row">
        <div className="column left">
          <div className="inputlabel" data-tip={this.props["data-tip"]}>
            {this.props.desc}
          </div>
        </div>
        <select
          className="column right"
          name={this.props.desc}
          id={this.props.desc}
          value={this.state.value}
          onChange={this.handleChange}
          data-tip={this.props["data-tip"]}
        >
          {fields}
        </select>
      </div>
    );
  }
}

export class InputField extends React.Component {
  constructor(props) {
    super(props);
    //console.log(this.props)
    this.state = { value: this.props.value, valid: true };
    this.handleChange = this.handleChange.bind(this);
    this.debounceChange = this.debounceChange.bind(this);
    this.delayTimer = null;
    this.newValue = null;
  }

  componentDidUpdate(prevProps) {
    if (!isEqual(this.props.value, prevProps.value)) {
      this.setState({ value: this.props.value });
    }
  }

  debounceChange() {
    clearTimeout(this.delayTimer);
    this.delayTimer = setTimeout(() => {
      this.props.onChange({ id: this.props.id, value: this.newValue });
    }, 1000);
  }

  handleChange(event) {
    console.log("event value:", event.target.value);
    var parsedvalue;
    if (this.props.type === "float") {
      parsedvalue = parseFloat(event.target.value);
      if (isNaN(parsedvalue)) {
        parsedvalue = null;
      }
    } else if (this.props.type === "int") {
      parsedvalue = parseInt(event.target.value);
      if (isNaN(parsedvalue)) {
        parsedvalue = null;
      }
    } else if (this.props.type === "floatlist") {
      parsedvalue = [];
      var values = event.target.value.split(",");
      console.log("---split", values);
      var tempvalue;
      for (var i = 0; i < values.length; i++) {
        tempvalue = parseFloat(values[i]);
        if (isNaN(tempvalue)) {
          parsedvalue = null;
          break;
        }
        else {
          parsedvalue.push(tempvalue);
        }
      }
      console.log("string to array", parsedvalue);
    } else {
      parsedvalue = event.target.value;
    }
    console.log("parsed value:", parsedvalue);
    var valid = false;
    if (parsedvalue != null) {
      valid = true;
      this.newValue = parsedvalue;
      this.debounceChange();
    }
    //this.props.onChange({ id: this.props.id, value: value });
    this.setState({ value: event.target.value, valid: valid});
  }

  render() {
    var type = "text";
    var value = this.state.value;
    //if (["int", "float"].includes(this.props.type)) {
    //  //type = "number";
    //  value = this.state.value;
    //} else if (this.props.type === "floatlist") {
    //  //type = "text";
    //  value = this.state.value.join(", ");
    //  console.log("array to string", value);
    //} else {
    //  //type = this.props.type;
    //  value = this.state.value;
    //}
    var bg_color;
    if (this.state.valid)  {
      bg_color = "#FFFFFF"
    }
    else {
      bg_color =  "#FFAAAA"
    }
    return (
      <div className="row">
        <div className="column left">
          <div className="inputlabel" data-tip={this.props["data-tip"]}>
            {this.props.desc}
          </div>
        </div>
        <input
          className="column right"
          type={type}
          value={value}
          onChange={this.handleChange}
          data-tip={this.props["data-tip"]}
          style={{backgroundColor: bg_color}}
        />
      </div>
    );
  }
}

export class ParameterInput extends React.Component {
  constructor(props) {
    super(props);
    this.state = {parameters: cloneDeep(this.props.parameters)};
  }

  componentDidUpdate(prevProps) {
    if (!isEqual(this.props.parameters, this.state.parameters)) {
      this.setState({parameters: cloneDeep(this.props.parameters)});
    }
  }

  handleChange = (event) => {
    //event.preventDefault();
    console.log("parameterinput", event);
    var id = event.id;
    console.log("change", id);
    this.setState((state) => {
      console.log("state before", state);
      var parameters = Object.assign({}, state.parameters);
      parameters[id] = event.value;
      console.log("state after", parameters);
      this.props.onChange(parameters);
      return {parameters: parameters};
    });
  };

  type_dict = {
    channel: { type: "int", desc: "channel", tooltip: "Channel number" },
  };

  get_input(par, value) {
    const pars = this.type_dict[par];
    if (pars) {
      var tooltip = pars["tooltip"];
      return (
        <InputField
          data-tip={tooltip}
          key={par}
          desc={pars.desc}
          id={par}
          type={pars.type}
          value={value}
          onChange={this.handleChange}
        />
      );
    }
  }

  render() {
    console.log("ParameterInput", this.props.parameters);
    var fields = Object.keys(this.props.parameters).map((val, i) => {
      var input = this.get_input(val, this.props.parameters[val]);
      return input;
    });
    return <div className="parameterinput">{fields}</div>;
  }
}

//TODO is this still needed?
export class ImagePopup extends React.Component {
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