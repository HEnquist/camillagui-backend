import React from "react";
import isEqual from "lodash/isEqual";
import "./index.css";

export class VolumeSlider extends React.Component {
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
    this.setState({ value: event.target.value });
    this.props.onChange(event.target.value);
  }

  render() {
    return (
      <div className="slidecontainer">
        <span style={{width: '20%'}}>{this.state.value}dB</span>
        <input
          style={{width: '80%'}}
          type="range"
          min="-99"
          max="0"
          value={this.state.value}
          className="slider"
          id="volume"
          onChange={this.handleChange}
        />
      </div>
    );
  }
}
