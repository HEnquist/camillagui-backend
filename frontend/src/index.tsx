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
import {delayedExecutor, MdiButton, MdiIcon} from "./utilities/ui-components"
import {cloneDeep} from "lodash"
import {mdiAlertCircle, mdiImageSizeSelectSmall, mdiArrowULeftTop, mdiArrowURightTop} from "@mdi/js"
import {SidePanel} from "./sidepanel/sidepanel"
import {Update} from "./utilities/common"
import {CompactView, isCompactViewEnabled, setCompactViewEnabled} from "./compactview"
import {UndoRedo} from "./main/UndoRedo"

class CamillaConfig extends React.Component<
  unknown,
  {
    activetab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    undoRedo: UndoRedo<Config>
    errors: ErrorsForPath
    compactView: boolean
    message: string
  }
> {

  constructor(props: unknown) {
    super(props)
    this.updateConfig = this.updateConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.setCompactViewEnabled = this.setCompactViewEnabled.bind(this)
    this.NormalContent = this.NormalContent.bind(this)
    this.state = {
      activetab: 1,
      guiConfig: defaultGuiConfig(),
      undoRedo: new UndoRedo(defaultConfig()),
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
    if (config)
      this.setState({message: "OK", undoRedo: new UndoRedo(config)})
    else
      this.setState({message: "No config received"})
  }

  private setCompactViewEnabled(enabled: boolean) {
    setCompactViewEnabled(enabled)
    this.setState({compactView: enabled})
  }

  private readonly saveTimer = delayedExecutor(100)

  private updateConfig(update: Update<Config>, saveAfterDelay: boolean = false) {
    this.setState(
        prevState => {
          const newConfig = cloneDeep(prevState.undoRedo.current())
          update(newConfig)
          return {undoRedo: prevState.undoRedo.changeTo(newConfig)}
        },
        () => {
          if (saveAfterDelay)
            this.saveTimer(this.applyConfig)
        })
  }

  private async applyConfig(): Promise<void> {
    const conf_req = await fetch("/api/setconfig", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        filename: this.state.currentConfigFile,
        config: this.state.undoRedo.current()
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
      undoRedo: new UndoRedo(config)
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
              config={this.state.undoRedo.current()}
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
    const undoRedo = this.state.undoRedo
    const config = undoRedo.current()
    return <>
      <SidePanel
          currentConfigFile={this.state.currentConfigFile}
          config={config}
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
          <Tab disabled={true}>
            <MdiButton
                icon={mdiImageSizeSelectSmall}
                tooltip="Change to compact view"
                onClick={() => this.setCompactViewEnabled(true)}
                buttonSize="tiny"/>
            <MdiButton
                icon={mdiArrowULeftTop}
                tooltip={"Undo last change<br>" + undoRedo.undoDiff()}
                buttonSize="tiny"
                style={{marginLeft: '10px', marginRight: '10px'}}
                onClick={() => this.setState(prevState => ({undoRedo: prevState.undoRedo.undo()}))}
                enabled={undoRedo.canUndo()}/>
            <MdiButton
                icon={mdiArrowURightTop}
                tooltip={"Redo last change<br>" + undoRedo.redoDiff()}
                buttonSize="tiny"
                onClick={() => this.setState(prevState => ({undoRedo: prevState.undoRedo.redo()}))}
                enabled={undoRedo.canRedo()}/>
          </Tab>
          <Tab>Devices {errors({path: ['devices'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Filters {errors({path: ['filters'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Mixers {errors({path: ['mixers'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Pipeline {errors({path: ['pipeline'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Files</Tab>
        </TabList>
        <TabPanel/>
        <TabPanel>
          <DevicesTab
              devices={config.devices}
              guiConfig={this.state.guiConfig}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'devices')}
          />
        </TabPanel>
        <TabPanel>
          <FiltersTab
              filters={config.filters}
              samplerate={config.devices.samplerate}
              channels={config.devices.capture.channels}
              coeffDir={this.state.guiConfig.coeff_dir}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'filters')}
          />
        </TabPanel>
        <TabPanel>
          <MixersTab
              mixers={config.mixers}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'mixers')}
          />
        </TabPanel>
        <TabPanel>
          <PipelineTab
              config={config}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'pipeline')}
          />
        </TabPanel>
        <TabPanel>
          <Files
              currentConfigFile={this.state.currentConfigFile}
              config={config}
              setCurrentConfig={this.setCurrentConfig}
          />
        </TabPanel>
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
  <CamillaConfig/>,
  document.getElementById("root")
)