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
        <div className="split-20-80">
          <div>{this.state.value}dB</div>
          <input
              style={{width: '100%', margin: 0, padding: 0}}
              type="range"
              min="-99"
              max="0"
              value={this.state.value}
              id="volume"
              onChange={this.handleChange}
          />
        </div>
    );
  }
}
