import React from "react";
import "./index.css";
import { Line } from "rc-progress";

export class VuMeterGroup extends React.Component {
  render() {
    var meters = this.props.level.map((value, idx) => {
      return (
        <VuMeter level={value} clipped={this.props.clipped} />
      );
    });
    return (
      <div>
        {meters}
      </div>
    )
  }
}

export class VuMeter extends React.Component {
  render() {
    var level = this.props.level;
    console.log("before", level);
    var color = "#00ff00";
    if (this.props.clipped) {
      color = "#ff2800";
    }
    if (level < -100) {
      level = -100;
    }
    if (level > 0) {
      level = 0;
    }
    level = level + 100;
    console.log(level);
    return (
      <Line
        percent={level}
        strokeWidth="4"
        trailWidth="4"
        strokeColor={color}
        strokeLinecap="square"
        trailColor="#E9E9E9"
      />
    );
  }
}
