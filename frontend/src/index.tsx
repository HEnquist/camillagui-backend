import * as React from "react";
import * as ReactDOM from "react-dom";
import "./index.css";
import { FilterList } from "./filterlist.js";
import { Devices } from "./devices.js";
import { MixerList } from "./mixerlist.js";
import { Pipeline } from "./pipeline.js";
import { SidePanel } from "./sidepanel.js";
import { Tab, Tabs, TabList, TabPanel } from "react-tabs";
import ReactTooltip from "react-tooltip";
import "react-tabs/style/react-tabs.css";

//export const FLASKURL = "http://127.0.0.1:5000";
export const FLASKURL = "";

class CamillaConfig extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.handleDevices = this.handleDevices.bind(this);
    this.handleFilters = this.handleFilters.bind(this);
    this.handleMixers = this.handleMixers.bind(this);
    this.handlePipeline = this.handlePipeline.bind(this);
    this.handleConfig = this.handleConfig.bind(this);
    this.getFullConfig = this.getFullConfig.bind(this);
    this.switchTab = this.switchTab.bind(this);
    this.state = {
      activetab: 0,
      guiConfig: {},
      config: this.createDefaultConfig()
    };
    window.fetch(FLASKURL + "/api/guiconfig")
        .then(data => data.json())
        .then(json => { this.setState({guiConfig: json}); });
  }

  private createDefaultConfig() {
    return {
      devices: {
        samplerate: 48000,

        //Buffers
        chunksize: 1024,
        target_level: 1024,
        queuelimit: 4,

        //Silence
        silence_threshold: 0,
        silence_timeout: 0,

        //Rate adjust
        enable_rate_adjust: false,
        adjust_period: 3,

        //Resampler
        enable_resampling: true,
        resampler_type: "FastAsync",
        capture_samplerate: 44100,

        capture: {type: "Alsa", channels: 2, format: "S32LE", device: "hw:0"},
        playback: {type: "Alsa", channels: 2, format: "S32LE", device: "hw:0"},
      },
      filters: {},
      mixers: {},
      pipeline: [],
    };
  }

  handleDevices(devices: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      //const devs = devices
      state.config.devices = devices;
      console.log("config", state);
      return { config: state.config };
    });
  }

  handleFilters(filters: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.filters = filters;
      console.log("config", state);
      return { config: state.config };
    });
  }

  handleMixers(mixers: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.mixers = mixers;
      console.log("config", state);
      return { config: state.config };
    });
  }

  handlePipeline(pipeline: any) {
    this.setState((prevState: any) => {
      const state = Object.assign({}, prevState);
      state.config.pipeline = pipeline;
      console.log("config", state);
      return { config: state.config };
    });
  }

  handleConfig(config: any) {
    this.setState((prevState: any) => {
      return { config: config };
    });
  }

  getFilterNames() {
    if (this.state.config.filters) {
      var filternames = Object.keys(this.state.config.filters);
      return filternames;
    } else {
      return [];
    }
  }

  getFullConfig(): any {
    return this.state.config;
  }

  getMixerNames(): any {
    if (this.state.config.mixers) {
      var mixernames = Object.keys(this.state.config.mixers);
      return mixernames;
    } else {
      return [];
    }
  }

  componentDidUpdate(prevProps: any) {
    ReactTooltip.rebuild();
    console.log("=============rebuild tooltips");
  }

  switchTab(index: number, lastIndex: number, event: Event) {
    this.setState((prevState: any) => {
      return { activetab: index };
    });
  }

  render() {
    return (
      <div className="configapp">
        <ReactTooltip multiline={true} />
        <div>
          <SidePanel config={this.state.config} onChange={this.handleConfig} />
        </div>
        <div>
          <Tabs
            className="configtabs"
            selectedIndex={this.state.activetab}
            onSelect={this.switchTab}
          >
            <TabList>
              <Tab>Devices</Tab>
              <Tab>Filters</Tab>
              <Tab>Mixers</Tab>
              <Tab>Pipeline</Tab>
            </TabList>
            <TabPanel>
              <Devices
                config={this.state.config.devices}
                guiConfig={this.state.guiConfig}
                onChange={this.handleDevices}
              />
            </TabPanel>
            <TabPanel>
              <FilterList
                config={this.state.config.filters}
                samplerate={this.state.config.devices.samplerate}
                onChange={this.handleFilters}
              />
            </TabPanel>
            <TabPanel>
              <MixerList
                config={this.state.config.mixers}
                onChange={this.handleMixers}
              />
            </TabPanel>
            <TabPanel>
              <Pipeline
                config={this.state.config.pipeline}
                filters={this.getFilterNames()}
                mixers={this.getMixerNames()}
                onChange={this.handlePipeline}
                getConfig={this.getFullConfig}
              />
            </TabPanel>
          </Tabs>
        </div>
      </div>
    );
  }
}

ReactDOM.render(
  //<BiquadFQ desc="2nd order lowpass"/>,
  <CamillaConfig />,
  document.getElementById("root")
);
