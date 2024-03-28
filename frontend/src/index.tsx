/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css"
import "./index.css"

import * as React from "react"
import {createRoot} from 'react-dom/client'
import isEqual from "lodash/isEqual"
import {FiltersTab} from "./filterstab"
import {DevicesTab} from "./devicestab"
import {MixersTab} from "./mixerstab"
import {ProcessorsTab} from "./processorstab"
import {PipelineTab} from "./pipeline/pipelinetab"
import {TitleTab} from "./titletab"
import {Shortcuts} from "./shortcuts"
import {ErrorsForPath, errorsForSubpath, noErrors} from "./utilities/errors"
import {Tab, TabList, TabPanel, Tabs} from "react-tabs"
import ReactTooltip from "react-tooltip"
import {Files} from "./filestab"
import {Config, defaultConfig, getCaptureChannelCount} from "./camilladsp/config"
import {defaultGuiConfig, GuiConfig} from "./guiconfig"
import {delayedExecutor, MdiButton, MdiIcon} from "./utilities/ui-components"
import {cloneDeep} from "lodash"
import {mdiAlert, mdiArrowULeftTop, mdiArrowURightTop, mdiImageSizeSelectSmall} from "@mdi/js"
import {SidePanel} from "./sidepanel/sidepanel"
import {Update} from "./utilities/common"
import {CompactView, isCompactViewEnabled, setCompactViewEnabled} from "./compactview"
import {UndoRedo} from "./main/UndoRedo"
import {loadActiveConfig} from "./utilities/files"

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
    unsavedChanges: boolean
    unappliedChanges: boolean
  }
> {

  constructor(props: unknown) {
    super(props)
    this.updateConfig = this.updateConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.saveAndApplyConfig = this.saveAndApplyConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setCurrentConfigFileName = this.setCurrentConfigFileName.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.setCompactViewEnabled = this.setCompactViewEnabled.bind(this)
    this.NormalContent = this.NormalContent.bind(this)
    this.saveNotify = this.saveNotify.bind(this)
    this.applyNotify = this.applyNotify.bind(this)
    this.state = {
      activetab: 1,
      guiConfig: defaultGuiConfig(),
      undoRedo: new UndoRedo(defaultConfig()),
      errors: noErrors,
      compactView: isCompactViewEnabled(),
      message: '',
      unsavedChanges: false,
      unappliedChanges: true,
    }
    this.loadGuiConfig()
    this.loadCurrentConfig()
  }

  private async loadGuiConfig() {
    fetch("/api/guiconfig")
        .then(data => data.json(), err => {console.log('Failed to fetch guiconfig', err)})
        .then(json => this.setState({guiConfig: json}), err => {console.log('Failed to parse guiconfig as json', err)})
  }

  private async loadCurrentConfig() {
    try {
      const json = await loadActiveConfig()
      this.setCurrentConfig(json.configFileName, json.config)
      this.setState({message: 'OK'})
    }
    catch(err) {
      console.log("Failed getting active config:", err)
    }
  }

  private async fetchConfig() {
    const conf_req = await fetch("/api/getconfig")
    if (!conf_req.ok) {
      const errorMessage = await conf_req.text()
      this.setState({message: errorMessage})
      throw new Error(errorMessage)
    }
    const config = await conf_req.json()
    if (config)
      this.setState({unsavedChanges: false, unappliedChanges: false, message: "OK", undoRedo: new UndoRedo(config)})
    else
      this.setState({message: "No config received"})
  }

  private setCompactViewEnabled(enabled: boolean) {
    setCompactViewEnabled(enabled)
    this.setState({compactView: enabled})
  }

  private saveNotify() {
    this.setState({unsavedChanges: false})
  }

  private applyNotify() {
    this.setState({unappliedChanges: false})
  }

  private readonly saveTimer = delayedExecutor(100)

  private updateConfig(update: Update<Config>, saveAfterDelay: boolean = false) {
    this.setState(
        prevState => {
          const newConfig = cloneDeep(prevState.undoRedo.current())
          update(newConfig)
          let unsavedChanges = true
          let unappliedChanges = true
          if (isEqual(newConfig, prevState.undoRedo.current())) {
            unsavedChanges = prevState.unsavedChanges
            unappliedChanges = prevState.unappliedChanges
          }
          return {unsavedChanges: unsavedChanges, unappliedChanges: unappliedChanges, undoRedo: prevState.undoRedo.changeTo(newConfig)}
        },
        () => {
          if (saveAfterDelay)
            this.saveTimer(this.applyConfig)
        })
  }

  private async applyConfig(): Promise<void> {
    this.applyConfigRequest(
      this.state.currentConfigFile,
      this.state.undoRedo.current()
    )
  }

  private async applyConfigRequest(filename: string | undefined, config: Config): Promise<void> {
    const conf_req = await fetch("/api/setconfig", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        filename: filename,
        config: config
      }),
    })
    const message = await conf_req.text()
    this.setState({message: message, unappliedChanges: false})
    if (!conf_req.ok)
      throw new Error(message)
  }

  private async saveConfig() {
    if (this.state.currentConfigFile) {
      const conf_req = await fetch("/api/saveconfigfile", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          filename: this.state.currentConfigFile,
          config: this.state.undoRedo.current()
        }),
      })
      const message = await conf_req.text()
      this.setState({message: message, unsavedChanges: false})
      if (!conf_req.ok)
        throw new Error(message)
    }
  }

  private async saveAndApplyConfig() {
    await this.applyConfig()
    await this.saveConfig()
  }

  private setCurrentConfig(filename: string | undefined, config: Config) {
    this.setState({
      unsavedChanges: false,
      unappliedChanges: true, 
      currentConfigFile: filename,
      undoRedo: new UndoRedo(config)
    })
  }

  private setCurrentConfigFileName(filename: string | undefined) {
    this.setState({
      currentConfigFile: filename,
    })
  }

  private setErrors(errors: any) {
    this.setState({errors: errors})
  }

  componentDidUpdate(prevProps: unknown) {
    ReactTooltip.rebuild()
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
                this.applyConfigRequest(filename, config)
              }}
              updateConfig={update => this.updateConfig(update, true)}
              disableCompactView={() => this.setCompactViewEnabled(false)}
              guiConfig={this.state.guiConfig}
          />
          : <this.NormalContent/>
      }
    </div>
  }

  private NormalContent() {
    const {errors, undoRedo, currentConfigFile} = this.state
    const config = undoRedo.current()
    return <>
      <SidePanel
          currentConfigFile={currentConfigFile}
          config={config}
          guiConfig={this.state.guiConfig}
          applyConfig={this.applyConfig}
          fetchConfig={this.fetchConfig}
          saveConfig={this.saveConfig}
          saveAndApplyConfig={this.saveAndApplyConfig}
          setErrors={this.setErrors}
          message={this.state.message}
          unsavedChanges={this.state.unsavedChanges}
          unappliedChanges={this.state.unappliedChanges}
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
          <Tab>Title</Tab>
          <Tab>Devices {errors({path: ['devices'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Filters {errors({path: ['filters'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Mixers {errors({path: ['mixers'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Processors {errors({path: ['processors'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Pipeline {errors({path: ['pipeline'], includeChildren: true}) && <ErrorIcon/>}</Tab>
          <Tab>Files</Tab>
          <Tab>Shortcuts</Tab>
        </TabList>
        <TabPanel/>
        <TabPanel>
          <TitleTab
              config={config}
              updateConfig={this.updateConfig}
          />
        </TabPanel>
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
              config={config}
              samplerate={config.devices.samplerate}
              channels={getCaptureChannelCount(config)}
              coeffDir={this.state.guiConfig.coeff_dir}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'filters')}
          />
        </TabPanel>
        <TabPanel>
          <MixersTab
              mixers={config.mixers ? config.mixers : {}}
              updateConfig={this.updateConfig}
              errors={errorsForSubpath(errors, 'mixers')}
          />
        </TabPanel>
        <TabPanel>
          <ProcessorsTab
              processors={config.processors ? config.processors : {}}
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
              currentConfigFile={currentConfigFile}
              config={config}
              setCurrentConfig={this.setCurrentConfig}
              setCurrentConfigFileName={this.setCurrentConfigFileName}
              updateConfig={this.updateConfig}
              saveNotify={this.saveNotify}
              guiConfig={this.state.guiConfig}
          />
        </TabPanel>
        <TabPanel>
          <Shortcuts
              currentConfigName={currentConfigFile}
              config={this.state.undoRedo.current()}
              setConfig={(filename, config) => {
                this.setCurrentConfig(filename, config)
                this.applyConfigRequest(filename, config)
              }}
              updateConfig={update => this.updateConfig(update, true)}
              shortcutSections={this.state.guiConfig.custom_shortcuts}
          />
        </TabPanel>
      </Tabs>
    </>
  }
}

function ErrorIcon() {
  return <MdiIcon
      icon={mdiAlert}
      tooltip="There are errors on this tab"
      style={{color: 'var(--error-text-color)'}}/>
}

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(<CamillaConfig/>)