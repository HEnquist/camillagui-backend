import React from "react";
import "./index.css";
import Popup from "reactjs-popup";
import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import {Scatter} from 'react-chartjs-2';

export class BoolSelect extends React.Component {
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

  handleChange(event) {
    this.setState({ value: event.target.checked });
    this.props.onChange({ id: this.props.id, value: event.target.checked });
  }

  render() {
    return (
      <div className="row">
        <div className="column left">
          <div className="inputlabel" data-tip={this.props["data-tip"]}>
            {this.props.desc}
          </div>
        </div>
        <div className="column right">
          <input
            type="checkbox"
            name={this.props.id}
            id={this.props.id}
            checked={this.state.value}
            onChange={this.handleChange}
            data-tip={this.props["data-tip"]}
          ></input>
        </div>
      </div>
    );
  }
}

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
    filter: [
      "Biquad",
      "BiquadCombo",
      "Conv",
      "Delay",
      "Gain",
      "Dither",
      "DiffEq",
    ],
    Biquad: [
      "Lowpass",
      "Highpass",
      "Highshelf",
      "Lowshelf",
      "LowpassFO",
      "HighpassFO",
      "HighshelfFO",
      "LowshelfFO",
      "Peaking",
      "Notch",
      "Allpass",
      "AllpassFO",
      "LinkwitzTransform",
      "Free",
    ],
    BiquadCombo: [
      "ButterworthHighpass",
      "ButterworthLowpass",
      "LinkwitzRileyHighpass",
      "LinkwitzRileyLowpass",
    ],
    coeffformat: [
      "S16LE",
      "S24LE",
      "S24LE3",
      "S32LE",
      "FLOAT32LE",
      "FLOAT64LE",
      "TEXT",
    ],
    sampleformat: [
      "S16LE",
      "S24LE",
      "S24LE3",
      "S32LE",
      "FLOAT32LE",
      "FLOAT64LE",
    ],
    resampler: ["FastAsync", "BalancedAsync", "AccurateAsync", "Synchronous"],
    delayunit: ["ms", "samples"],
    Conv: ["File", "Values"],
    backend_capture: ["Alsa", "Pulse", "Wasapi", "CoreAudio", "File", "Stdin"],
    backend_playback: [
      "Alsa",
      "Pulse",
      "Wasapi",
      "CoreAudio",
      "File",
      "Stdout",
    ],
    Dither: [
      "Simple",
      "Uniform",
      "Lipshitz441",
      "Fweighted441",
      "Shibata441",
      "Shibata48",
      "None",
    ],
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
        <div className="column right">
          <select
            name={this.props.desc}
            id={this.props.desc}
            value={this.state.value}
            onChange={this.handleChange}
            data-tip={this.props["data-tip"]}
          >
            {fields}
          </select>
        </div>
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
    var value;
    if (this.props.type === "float") {
      value = parseFloat(event.target.value);
    } else if (this.props.type === "int") {
      value = parseInt(event.target.value);
    } else if (this.props.type === "floatlist") {
      value = [];
      var values = event.target.value.split(",");
      console.log("---split", values);
      for (var i = 0; i < values.length; i++) {
        value.push(parseFloat(values[i]));
      }
      console.log("string to array", value);
    } else {
      value = event.target.value;
    }
    this.newValue = value;
    this.debounceChange();
    //this.props.onChange({ id: this.props.id, value: value });
    this.setState({ value: value });
  }

  render() {
    var type;
    var value;
    if (["int", "float"].includes(this.props.type)) {
      type = "number";
      value = this.state.value;
    } else if (this.props.type === "floatlist") {
      type = "text";
      value = this.state.value.join(", ");
      console.log("array to string", value);
    } else {
      type = this.props.type;
      value = this.state.value;
    }
    return (
      <div className="row">
        <div className="column left">
          <div className="inputlabel" data-tip={this.props["data-tip"]}>
            {this.props.desc}
          </div>
        </div>
        <div className="column left">
          <input
            type={type}
            value={value}
            onChange={this.handleChange}
            data-tip={this.props["data-tip"]}
          />
        </div>
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

  special_types = {
    Conv: {
      format: {
        type: "enum",
        desc: "format",
        subtype: "coeffformat",
        tooltip: "Sample format",
      },
    },
  };

  type_dict = {
    a: {
      type: "floatlist",
      desc: "a",
      tooltip: "Comma-separated list of coefficients for a",
    },
    a1: {
      type: "float",
      desc: "a1",
      tooltip: "Value for Biquad a1 coefficient",
    },
    a2: {
      type: "float",
      desc: "a2",
      tooltip: "Value for Biquad a2 coefficient",
    },
    b0: {
      type: "float",
      desc: "b0",
      tooltip: "Value for Biquad b0 coefficient",
    },
    b1: {
      type: "float",
      desc: "b1",
      tooltip: "Value for Biquad b1 coefficient",
    },
    b2: {
      type: "float",
      desc: "b2",
      tooltip: "Value for Biquad b2 coefficient",
    },
    adjust_period: {
      type: "int",
      desc: "adjust_period",
      tooltip: "Delay in seconds between rate adjustments",
    },
    amplitude: {
      type: "float",
      desc: "amplitude",
      tooltip: "Dither amplitude relative to target LSB",
    },
    b: {
      type: "floatlist",
      desc: "b",
      tooltip: "Comma-separated list of coefficients for b",
    },
    bits: { type: "int", desc: "bits", tooltip: "Target bit depth for dither" },
    capture_samplerate: {
      type: "int",
      desc: "capture_samplerate",
      tooltip:
        "Sample rate for capture device.<br>If different than 'samplerate' then resampling must be enabled",
    },
    channel: { type: "int", desc: "channel", tooltip: "Channel number" },
    channels: { type: "int", desc: "channels", tooltip: "Number of channels" },
    chunksize: {
      type: "int",
      desc: "chunksize",
      tooltip: "Chunksize for the processing",
    },
    delay: { type: "float", desc: "delay", tooltip: "Delay in ms or samples" },
    dest: { type: "int", desc: "dest", tooltip: "Destination channel" },
    device: { type: "text", desc: "device", tooltip: "Name of device" },
    enable_rate_adjust: {
      type: "bool",
      desc: "enable_rate_adjust",
      tooltip: "Enable rate adjust",
    },
    enable_resampling: {
      type: "bool",
      desc: "enable_resampling",
      tooltip: "Enable rasampling",
    },
    extra_samples: {
      type: "int",
      desc: "extra_samples",
      tooltip: "Number of extra samples to insert after end of file",
    },
    file: { type: "text", desc: "file", tooltip: "Filename including path" },
    filename: {
      type: "text",
      desc: "filename",
      tooltip: "Filename including path",
    },
    format: {
      type: "enum",
      desc: "format",
      subtype: "sampleformat",
      tooltip: "Sample format",
    },
    freq: { type: "float", desc: "freq", tooltip: "Frequency" },
    freq_act: {
      type: "float",
      desc: "freq_act",
      tooltip: "Frequency of actual system",
    },
    freq_target: {
      type: "float",
      desc: "freq_target",
      tooltip: "Target frequency",
    },
    gain: { type: "float", desc: "gain", tooltip: "Gain in dB" },
    in: { type: "int", desc: "in", tooltip: "Number of channels in" },
    inverted: { type: "bool", desc: "inverted", tooltip: "Invert signal" },
    length: {
      type: "int",
      desc: "length",
      tooltip: "Number of coefficients to generate",
    },
    order: { type: "int", desc: "order", tooltip: "Filter order" },
    out: { type: "int", desc: "out", tooltip: "Number of channels in" },
    q: { type: "float", desc: "Q", tooltip: "Q-value" },
    q_act: {
      type: "float",
      desc: "Q actual",
      tooltip: "Q-value of actual system",
    },
    q_target: { type: "float", desc: "Q target", tooltip: "Target Q-value" },
    queuelimit: {
      type: "int",
      desc: "queuelimit",
      tooltip: "Length limit for internal queues",
    },
    read_bytes: {
      type: "int",
      desc: "read_bytes",
      tooltip: "Read up to this number of bytes",
    },
    read_bytes_lines: {
      type: "int",
      desc: "read_bytes_lines",
      tooltip: "Read up to this number of bytes or lines",
    },
    resampler_type: {
      type: "enum",
      desc: "resampler type",
      subtype: "resampler",
      tooltip: "Resampler type",
    },
    samplerate: {
      type: "int",
      desc: "samplerate",
      tooltip: "Sample rate for processing and output",
    },
    silence_threshold: {
      type: "float",
      desc: "silence_threshold",
      tooltip: "Threshold for silence in dB",
    },
    silence_timeout: {
      type: "float",
      desc: "silence_timeout",
      tooltip: "Pause processing after this many seconds of silence",
    },
    skip_bytes: {
      type: "int",
      desc: "skip_bytes",
      tooltip: "Number of bytes to skip at beginning of file",
    },
    skip_bytes_lines: {
      type: "int",
      desc: "skip_bytes_lines",
      tooltip: "Number of bytes or lines to skip at beginning of file",
    },
    slope: {
      type: "float",
      desc: "slope",
      tooltip: "Filter slope in dB per octave",
    },
    target_level: {
      type: "int",
      desc: "target_level",
      tooltip: "Target output buffer fill level for rate adjust",
    },
    unit: {
      type: "enum",
      desc: "unit",
      subtype: "delayunit",
      tooltip: "Unit for delay",
    },
    values: {
      type: "floatlist",
      desc: "values",
      tooltip: "Comma separated list of filter coefficients",
    },
  };

  get_input(par, value) {
    var pars;
    if (this.special_types.hasOwnProperty(this.props.context)) {
      if (this.special_types[this.props.context].hasOwnProperty(par)) {
        pars = this.special_types[this.props.context][par];
      } else {
        pars = this.type_dict[par];
      }
    } else {
      pars = this.type_dict[par];
    }
    if (pars) {
      var tooltip = pars["tooltip"];
      if (pars.type === "bool") {
        return (
          <BoolSelect
            data-tip={tooltip}
            key={par}
            desc={pars.desc}
            id={par}
            value={value}
            onChange={this.handleChange}
          />
        );
      } else if (pars.type === "enum") {
        return (
          <EnumSelect
            data-tip={tooltip}
            key={par}
            desc={pars.desc}
            type={pars.subtype}
            value={value}
            onSelect={this.handleChange}
          />
        );
      } else {
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

export class ListSelectPopup extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: props.open, items: props.items };
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.pickItem = this.pickItem.bind(this);
  }
  
  openModal() {
    this.setState({ open: true });
  }

  closeModal() {
    this.setState({ open: false });
    this.props.onClose(this.props.id);
  }

  pickItem(event) {
    this.props.onSelect(event.target.id);
    this.setState({ open: false });
    this.props.onClose(this.props.id);
  }

  render() {
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
              {Object.keys(this.state.items).map((item, i) => {
                return (
                  <div
                    id={item}
                    className="popuplistitem"
                    key={item}
                    onClick={this.pickItem}
                  >
                    {item}
                  </div>
                );
              })}
            </div>
          </div>
        </Popup>
      </div>
    );
  }
}

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

export class ChartPopup extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: props.open, data: props.data };
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

  make_pointlist(xvect, yvect) {
    var points = xvect.map((x, idx) => {
      return (
        {x: x, y: yvect[idx]}
      );
    });
    return points
  }

  render() {
    var name = "";
    console.log(this.state)
    if (this.state.data.hasOwnProperty("name")) {
      name = this.state.data["name"];
    }
    var data = {
      labels: [name],
      datasets: []
    };

    if (this.state.data.hasOwnProperty("magnitude")) {
      var gainpoints = this.make_pointlist(this.state.data["f"], this.state.data["magnitude"])
      data.datasets.push(
        {
          label: 'Gain',
          fill: false,
          borderColor: 'rgba(0,0,220,1)',
          pointRadius: 0,
          showLine: true,
          data: gainpoints,
          yAxisID: "gain",
          xAxisID: "freq",
        }
      )
    }

    if (this.state.data.hasOwnProperty("phase")) {
      var phasepoints = this.make_pointlist(this.state.data["f"], this.state.data["phase"])
      data.datasets.push(
        {
          label: 'Phase',
          fill: false,
          borderColor: 'rgba(0,220,0,1)',
          pointRadius: 0,
          showLine: true,
          data: phasepoints,
          yAxisID: "phase",
          xAxisID: "freq",
        }
      )
    }

    if (this.state.data.hasOwnProperty("impulse")) {
      var impulsepoints = this.make_pointlist(this.state.data["time"], this.state.data["impulse"])
      data.datasets.push(
        {
          label: 'Impulse',
          fill: false,
          borderColor: 'rgba(220,0,0,1)',
          pointRadius: 0,
          showLine: true,
          data: impulsepoints,
          yAxisID: "ampl",
          xAxisID: "time",
        }
      )
    }

    const options = {
      scales: {
        xAxes: [
          {
            id: "freq",
            type: 'logarithmic',
            position: 'bottom'
          },
          {
            id: "time",
            type: 'linear',
            position: 'top'
          }
        ],
        yAxes: [
          {
            id: "gain",
            type: 'linear',
            position: 'left',
            ticks: {
              fontColor: 'rgba(0,0,220,1)'
            }
          },
          {
            id: "phase",
            type: 'linear',
            position: 'right',
            ticks: {
              fontColor: 'rgba(0,220,0,1)',
              suggestedMin: -180,
              suggestedMax: 180
            }
          },
          {
            id: "ampl",
            type: 'linear',
            position: 'right',
            ticks: {
              fontColor: 'rgba(220,0,0,1)'
            }
          }
        ]
      }
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
              <Scatter data={data} options={options} />
            </div>
          </div>
        </Popup>
      </div>
    );
  }
}

