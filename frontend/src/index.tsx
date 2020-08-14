import * as React from "react"
import * as ReactDOM from "react-dom"
import './index.css';
import { FilterList } from './filterlist.js';
import { Devices } from './devices.js';
import { MixerList } from './mixerlist.js';
import { Pipeline } from './pipeline.js';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import 'react-tabs/style/react-tabs.css';

class CamillaConfig extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.handleDevices = this.handleDevices.bind(this);
    this.handleFilters = this.handleFilters.bind(this);
    this.handleMixers = this.handleMixers.bind(this);
    this.handlePipeline = this.handlePipeline.bind(this);
    this.getFullConfig = this.getFullConfig.bind(this);
    //this.state = {value: this.props.value};
    this.state = {
      config: {
        devices: this.getDevicesTemplate(),
        filters: this.getFiltersTemplate(),
        mixers: this.getMixersTemplate(),
        pipeline: this.getPipelineTemplate(),
      }
    };
  }

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

  handleMixers(mixers: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.mixers = mixers;
      console.log("config", state);
      return { config: state.config };
    })
  }

  handlePipeline(pipeline: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.pipeline = pipeline;
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

  getFiltersTemplate() {
    return ({
      test1: {
        "type": "Biquad", 
        "parameters": {
          "type": "Lowpass", 
          "q": 0.7, 
          "freq": 500,
        }
      }
    });
  }

  getMixersTemplate() {
    return ({});
  }

  getPipelineTemplate() {
    return ([]);
  }

  getFilterNames() {
    if (this.state.config.filters) {
      var filternames = Object.keys(this.state.config.filters);
      return filternames
    }
    else {
      return []
    }
  }

  getFullConfig():any {
    return this.state.config;
  }

  getMixerNames():any {
    if (this.state.config.mixers) {
      var mixernames = Object.keys(this.state.config.mixers);
      return mixernames
    }
    else {
      return []
    }
  }

  render() {
    return (
      <Tabs >
        <TabList >
          <Tab>Devices</Tab>
          <Tab>Filters</Tab>
          <Tab>Mixers</Tab>
          <Tab>Pipeline</Tab>
        </TabList>

        <TabPanel>
          <Devices config={this.state.config.devices} onChange={this.handleDevices}/>
        </TabPanel>
        <TabPanel>
          <FilterList config={this.state.config.filters} onChange={this.handleFilters}/>
        </TabPanel>
        <TabPanel>
          <MixerList config={this.state.config.mixers} onChange={this.handleMixers}/>
        </TabPanel>
        <TabPanel>
          <Pipeline config={this.state.config.pipeline} filters={this.getFilterNames()} mixers={this.getMixerNames()} onChange={this.handlePipeline} getConfig={this.getFullConfig}/>
        </TabPanel>
      </Tabs>
    );
  }
}


ReactDOM.render(
  //<BiquadFQ desc="2nd order lowpass"/>,
  <CamillaConfig />,
  document.getElementById('root')
);