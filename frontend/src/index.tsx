/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css";
import "./index.css";

import * as React from "react";
import * as ReactDOM from "react-dom";
import {FiltersTab} from "./filterstab";
import {DevicesTab} from "./devicestab";
import {MixersTab} from "./mixerstab";
import {PipelineTab} from "./pipelinetab";
import {SidePanel} from "./sidepanel";
import {Tab, TabList, TabPanel, Tabs} from "react-tabs";
import ReactTooltip from "react-tooltip";
import {Files} from "./files";
import {Config, defaultConfig} from "./config";
import {defaultGuiConfig, GuiConfig} from "./guiconfig";
import {MdiIcon, Update} from "./common-tsx";
import cloneDeep from "lodash/cloneDeep";
import {mdiAlertCircle} from "@mdi/js";

class CamillaConfig extends React.Component<
  unknown,
  {
    activetab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    config: Config
    errors: any
  }
> {
  constructor(props: unknown) {
    super(props)
    this.handleConfig = this.handleConfig.bind(this)
    this.updateConfig = this.updateConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.state = {
      activetab: 0,
      guiConfig: defaultGuiConfig(),
      config: defaultConfig(),
      errors: {}
    }
    fetch("/api/guiconfig")
        .then(data => data.json())
        .then(json => this.setState({guiConfig: json}))
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

  private setCurrentConfig(filename: string, config: Config) {
    this.setState({
      currentConfigFile: filename,
      config: config
    });
  }

  private setErrors(errors: any) {
    this.setState({errors: errors})
  }

  componentDidUpdate(prevProps: unknown) {
    ReactTooltip.rebuild()
    console.log("=============rebuild tooltips")
  }

  private switchTab(index: number) {
    this.setState({activetab: index})
  }

  render() {
    const errors = this.state.errors;
    return <div className="configapp">
      <ReactTooltip multiline={true} />
      <SidePanel
          currentConfigFile={this.state.currentConfigFile}
          config={this.state.config}
          setConfig={this.handleConfig}
          setErrors={this.setErrors}
          setCurrentConfig={this.setCurrentConfig}
      />
      <Tabs
          className="configtabs"
          selectedIndex={this.state.activetab}
          onSelect={this.switchTab}
      >
        <TabList>
          <Tab>Devices {errors.devices && <ErrorIcon/>}</Tab>
          <Tab>Filters {errors.filters && <ErrorIcon/>}</Tab>
          <Tab>Mixers {errors.mixers && <ErrorIcon/>}</Tab>
          <Tab>Pipeline {errors.pipeline && <ErrorIcon/>}</Tab>
          <Tab>Files</Tab>
        </TabList>
        <TabPanel>
          <DevicesTab
              devices={this.state.config.devices}
              guiConfig={this.state.guiConfig}
              updateConfig={this.updateConfig}
              errors={errors.devices}
          />
        </TabPanel>
        <TabPanel>
          <FiltersTab
              filters={this.state.config.filters}
              samplerate={this.state.config.devices.samplerate}
              coeffDir={this.state.guiConfig.coeff_dir}
              updateConfig={this.updateConfig}
              errors={errors.filters}
          />
        </TabPanel>
        <TabPanel>
          <MixersTab
              mixers={this.state.config.mixers}
              updateConfig={this.updateConfig}
          />
        </TabPanel>
        <TabPanel>
          <PipelineTab
              config={this.state.config}
              updateConfig={this.updateConfig}
          />
        </TabPanel>
        <TabPanel>
          <Files
              currentConfigFile={this.state.currentConfigFile}
              config={this.state.config}
              setCurrentConfig={this.setCurrentConfig}
          />
        </TabPanel>
      </Tabs>
    </div>
  }
}

function ErrorIcon(props: {}) {
  return <MdiIcon
      icon={mdiAlertCircle}
      tooltip="There are errors on this tab"
      style={{color: 'var(--error-text-color)'}}/>
}

ReactDOM.render(
  <CamillaConfig />,
  document.getElementById("root")
)
