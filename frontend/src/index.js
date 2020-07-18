import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import { FilterList } from './filterlist.js';
import { Devices } from './devices.js';

class CamillaConfig extends React.Component {
  constructor(props) {
    super(props);
    this.handleDevices = this.handleDevices.bind(this);
    //this.state = {value: this.props.value};
    this.state = {config: {devices: this.getDevicesTemplate()}};
  }

  //handleChange(event) {    
  //  this.setState({value: event.target.value});  
  //  this.props.onSelectFilter(event.target.value);  
  //}

  handleDevices(devices) {
    this.setState(prevState => {
      const state = Object.assign({}, prevState);
      //const devs = devices
      state.config.devices = devices;
      console.log("config", state);
      return { config: state.config };
    })
  }

  getDevicesTemplate() {
    return ({
      samplerate: 48000,
      chunksize: 1024,
      target_level: 1024,
      adjust_period: 3,
      enable_resampling: true,
      resampler_type: "FastAsync",
      capture_samplerate: 44100,
    });
  }

  render() {
    return (
      <div className="configapp">
        <div>
          <Devices config={this.state.config.devices} onChange={this.handleDevices}/>
        </div>
        <div>
          <FilterList />
        </div>
      </div>
    );
  }
}


ReactDOM.render(
  //<BiquadFQ desc="2nd order lowpass"/>,
  <CamillaConfig />,
  document.getElementById('root')
);