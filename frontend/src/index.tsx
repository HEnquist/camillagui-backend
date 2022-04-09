/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css"
import "./index.css"

import * as React from "react"
import * as ReactDOM from "react-dom"
import {FiltersTab} from "./filterstab"
import {DevicesTab} from "./devicestab"
import {MixersTab} from "./mixerstab"
import {PipelineTab} from "./pipeline/pipelinetab"
import {ErrorsForPath, errorsForSubpath, noErrors} from "./utilities/errors"
import {Tab, TabList, TabPanel, Tabs} from "react-tabs"
import ReactTooltip from "react-tooltip"
import {Files, loadActiveConfig} from "./files"
import {Config, defaultConfig} from "./camilladsp/config"
import {defaultGuiConfig, GuiConfig} from "./guiconfig"
import {delayedExecutor, MdiIcon} from "./utilities/ui-components"
import {cloneDeep} from "lodash"
import {mdiAlertCircle, mdiImageSizeSelectSmall} from "@mdi/js"
import {SidePanel} from "./sidepanel/sidepanel"
import {Update} from "./utilities/common"
import {CompactView, isCompactViewEnabled, setCompactViewEnabled} from "./compactview"

class CamillaConfig extends React.Component<
  unknown,
  {
    activetab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    config: Config
    errors: ErrorsForPath
    compactView: boolean
    message: string
  }
> {

  constructor(props: unknown) {
    super(props)
    this.handleConfig = this.handleConfig.bind(this)
    this.updateConfig = this.updateConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.setCompactViewEnabled = this.setCompactViewEnabled.bind(this)
    this.NormalContent = this.NormalContent.bind(this)
    this.state = {
      activetab: 0,
      guiConfig: defaultGuiConfig(),
      config: defaultConfig(),
      errors: noErrors,
      compactView: isCompactViewEnabled(),
      message: ''
    }
    this.loadGuiConfig()
    this.loadCurrentConfig()
  }

  private async loadGuiConfig() {
    fetch("/api/guiconfig")
        .then(data => data.json())
        .then(json => this.setState({guiConfig: json}))
  }

  private async loadCurrentConfig() {
    const json = await loadActiveConfig()
    this.setCurrentConfig(json.configFileName, json.config)
    this.setState({message: 'OK'})
  }

  private async fetchConfig() {
    const conf_req = await fetch("/api/getconfig")
    if (!conf_req.ok) {
      const errorMessage = await conf_req.text();
      this.setState({message: errorMessage})
      throw new Error(errorMessage)
    }
    const config = await conf_req.json()
    if (config) {
      this.setState({message: "OK"})
      this.handleConfig(config)
    } else {
      this.setState({message: "No config received"})
    }
  }

  private setCompactViewEnabled(enabled: boolean) {
    setCompactViewEnabled(enabled)
    this.setState({compactView: enabled})
  }

  private handleConfig(config: Config) {
    this.setState({config: config})
  }

  private readonly saveTimer = delayedExecutor(100)

  private updateConfig(update: Update<Config>, saveAfterDelay: boolean = false) {
    this.setState(prevState => {
      const newConfig = cloneDeep(prevState.config)
      update(newConfig)
      if (saveAfterDelay)
        this.saveTimer(() => {this.applyConfig()})
      return { config: newConfig }
    })
  }

  private async applyConfig(): Promise<void> {
    const conf_req = await fetch("/api/setconfig", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        filename: this.state.currentConfigFile,
        config: this.state.config
      }),
    })
    const message = await conf_req.text()
    this.setState({message: message})
    if (!conf_req.ok)
      throw new Error(message)
  }

  private setCurrentConfig(filename: string, config: Config) {
    this.setState({
      currentConfigFile: filename,
      config: config
    })
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
    return <div className="configapp">
      <ReactTooltip multiline={true}/>
      {this.state.compactView ?
          <CompactView
              currentConfigName={this.state.currentConfigFile}
              config={this.state.config}
              setConfig={(filename, config) => {
                this.setCurrentConfig(filename, config)
                this.applyConfig()
              }}
              updateConfig={update => this.updateConfig(update, true)}
              disableCompactView={() => this.setCompactViewEnabled(false)}
          />
          : <this.NormalContent/>
      }
    </div>
  }

  private NormalContent() {
    const errors = this.state.errors
    return <>
      <SidePanel
          currentConfigFile={this.state.currentConfigFile}
          config={this.state.config}
          guiConfig={this.state.guiConfig}
          applyConfig={this.applyConfig}
          fetchConfig={this.fetchConfig}
          setErrors={this.setErrors}
          message={this.state.message}
      />
      <Tabs
          className="configtabs"
          selectedIndex={this.state.activetab}
          onSelect={this.switchTab}
      >
        <TabList>
          <Tab>Devices {errors({path: ['devices'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Filters {errors({path: ['filters'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Mixers {errors({path: ['mixers'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Pipeline {errors({path: ['pipeline'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Files</Tab>
          <Tab onClick={(e: React.MouseEvent<HTMLLIElement>) => {
            e.stopPropagation()
            this.setCompactViewEnabled(true)
          }}>
            <MdiIcon icon={mdiImageSizeSelectSmall} tooltip="Change to compact view"/>
          </Tab>
        </TabList>
        <TabPanel>
          <DevicesTab
              devices={this.state.config.devices}
              guiConfig={this.state.guiConfig}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'devices')}
          />
        </TabPanel>
        <TabPanel>
          <FiltersTab
              filters={this.state.config.filters}
              samplerate={this.state.config.devices.samplerate}
              channels={this.state.config.devices.capture.channels}
              coeffDir={this.state.guiConfig.coeff_dir}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'filters')}
          />
        </TabPanel>
        <TabPanel>
          <MixersTab
              mixers={this.state.config.mixers}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'mixers')}
          />
        </TabPanel>
        <TabPanel>
          <PipelineTab
              config={this.state.config}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'pipeline')}
          />
        </TabPanel>
        <TabPanel>
          <Files
              currentConfigFile={this.state.currentConfigFile}
              config={this.state.config}
              setCurrentConfig={this.setCurrentConfig}
          />
        </TabPanel>
        <TabPanel/>
      </Tabs>
    </>
  }
}

function ErrorIcon() {
  return <MdiIcon
      icon={mdiAlertCircle}
      tooltip="There are errors on this tab"
      style={{color: 'var(--error-text-color)'}}/>
}

ReactDOM.render(
  <CamillaConfig />,
  document.getElementById("root")
)