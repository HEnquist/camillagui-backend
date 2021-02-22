import * as React from "react";
import * as ReactDOM from "react-dom";
import "./index.css";
import {FiltersTab} from "./filterstab";
import {DevicesTab} from "./devicestab";
import {MixerList} from "./mixerlist.js";
import {PipelineTab} from "./pipelinetab.js";
import {SidePanel} from "./sidepanel";
import {Tab, TabList, TabPanel, Tabs} from "react-tabs";
import ReactTooltip from "react-tooltip";
import "react-tabs/style/react-tabs.css";
import {Files} from "./files";
import {Config, defaultConfig, filterNamesOf, mixerNamesOf, Mixers, Pipeline} from "./config";
import {defaultGuiConfig, GuiConfig} from "./guiconfig";
import {Update} from "./common-tsx";
import cloneDeep from "lodash/cloneDeep";

//export const FLASKURL = "http://127.0.0.1:5000"
export const FLASKURL = ""

class CamillaConfig extends React.Component<
  unknown,
  {
    activetab: number,
    activeConfigFile?: string,
    guiConfig: GuiConfig,
    config: Config
  }
> {
  constructor(props: unknown) {
    super(props)
    this.handleMixers = this.handleMixers.bind(this)
    this.handlePipeline = this.handlePipeline.bind(this)
    this.handleConfig = this.handleConfig.bind(this)
    this.updateConfig = this.updateConfig.bind(this)
    this.setActiveConfig = this.setActiveConfig.bind(this)
    this.getFullConfig = this.getFullConfig.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.state = {
      activetab: 0,
      guiConfig: defaultGuiConfig(),
      config: defaultConfig()
    }
    fetch(FLASKURL + "/api/guiconfig")
        .then(data => data.json())
        .then(json => this.setState({guiConfig: json}))
  }

  private handleMixers(mixers: Mixers) {
    this.setState(prevState => {
      const state = Object.assign({}, prevState)
      state.config.mixers = mixers
      return { config: state.config }
    })
  }

  private handlePipeline(pipeline: Pipeline) {
    this.setState(prevState => {
      const state = Object.assign({}, prevState)
      state.config.pipeline = pipeline
      return { config: state.config }
    })
  }

  private handleConfig(config: Config) {
    this.setState({config: config})
  }

  private updateConfig(update: Update<Config>) {
    this.setState(prevState => {
      const newConfig = cloneDeep(prevState.config)
      update(newConfig)
      return { config: newConfig }
    })
  }

  private setActiveConfig(filename: string, config: Config) {
    this.setState({
      activeConfigFile: filename,
      config: config
    });
  }

  private getFilterNames(): string[] {
    return filterNamesOf(this.state.config) //TODO call this directly from child components
  }

  private getFullConfig(): Config {
    return this.state.config //TODO remove and pass config as props
  }

  private getMixerNames(): string[] {
    return mixerNamesOf(this.state.config) //TODO call this directly from child components
  }

  componentDidUpdate(prevProps: unknown) {
    ReactTooltip.rebuild()
    console.log("=============rebuild tooltips")
  }

  private switchTab(index: number) {
    this.setState({activetab: index})
  }

  render() {
    return <div className="configapp">
      <ReactTooltip multiline={true} />
      <SidePanel
          activeConfigFile={this.state.activeConfigFile}
          config={this.state.config}
          setConfig={this.handleConfig}
          setActiveConfig={this.setActiveConfig}
      />
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
          <Tab>Files</Tab>
        </TabList>
        <TabPanel>
          <DevicesTab
              devices={this.state.config.devices}
              guiConfig={this.state.guiConfig}
              updateConfig={this.updateConfig}
          />
        </TabPanel>
        <TabPanel>
          <FiltersTab
              filters={this.state.config.filters}
              samplerate={this.state.config.devices.samplerate}
              coeffDir={this.state.guiConfig.coeff_dir}
              updateConfig={this.updateConfig}
          />
        </TabPanel>
        <TabPanel>
          <MixerList
              config={this.state.config.mixers}
              onChange={this.handleMixers}
          />
        </TabPanel>
        <TabPanel>
          <PipelineTab
              config={this.state.config.pipeline}
              filters={this.getFilterNames()}
              mixers={this.getMixerNames()}
              onChange={this.handlePipeline}
              getConfig={this.getFullConfig}
          />
        </TabPanel>
        <TabPanel>
          <Files
              activeConfigFile={this.state.activeConfigFile}
              config={this.state.config}
              setActiveConfig={this.setActiveConfig}
          />
        </TabPanel>
      </Tabs>
    </div>
  }
}

ReactDOM.render(
  <CamillaConfig />,
  document.getElementById("root")
)
