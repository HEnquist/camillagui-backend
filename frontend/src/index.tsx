import * as React from "react"
import * as ReactDOM from "react-dom"
import './index.css';
import { FilterList } from './filterlist.js';
import { Devices } from './devices.js';
import { MixerList } from './mixerlist.js';
import { Pipeline } from './pipeline.js';

class CamillaConfig extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.handleDevices = this.handleDevices.bind(this);
    //this.state = {value: this.props.value};
    this.state = {config: {devices: this.getDevicesTemplate()}};
  }

  //handleChange(event) {    
  //  this.setState({value: event.target.value});  
  //  this.props.onSelectFilter(event.target.value);  
  //}

  handleDevices(devices: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      //const devs = devices
      state.config.devices = devices;
      console.log("config", state);
      return { config: state.config };
    })
  }

  handleFilters(filters: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.filters = filters;
      console.log("config", state);
      return { config: state.config };
    })
  }

  handleMixers(filters: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.filters = filters;
      console.log("config", state);
      return { config: state.config };
    })
  }

  handlePipeline(filters: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.filters = filters;
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

  getFilterNames() {
    return ["filt1", "filt2"]
  }

  getMixerNames() {
    return ["mix1", "mix2"]
  }

  render() {
    return (
      <div className="configapp" >
        <div>
          <Devices config={this.state.config.devices} onChange={this.handleDevices}/>
        </div>
        <div>
          <FilterList onChange={this.handleFilters}/>
        </div>
        <div>
          <MixerList onChange={this.handleMixers}/>
        </div>
        <div>
          <Pipeline filters={this.getFilterNames()} mixers={this.getMixerNames()} onChange={this.handlePipeline}/>
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