/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css"
import "react-tooltip/dist/react-tooltip.css"
import "./index.css"

import * as React from "react"
import { mdiAlert, mdiArrowULeftTop, mdiArrowURightTop, mdiImageSizeSelectSmall, mdiPoll } from "@mdi/js"
import { cloneDeep } from "lodash"
import isEqual from "lodash/isEqual"
import { createRoot } from "react-dom/client"
import { Tab, TabList, TabPanel, Tabs } from "react-tabs"
import { Tooltip } from "react-tooltip"
import { api, errorMessage } from "./api/client"
import { Config, defaultConfig, getCaptureDeviceChannelCount } from "./camilladsp/config"
import { ControllerSettings, ControllerStatus, isFileless } from "./camilladsp/status"
import { CompactView, getViewMode, setViewMode, ViewMode } from "./compactview"
import type { CustomPageComponent } from "./custom-pages/types"
import { DashboardView } from "./dashboardview"
import { installDemoBackend } from "./demo/mockBackend"
import { DevicesTab } from "./devicestab"
import { DspTab } from "./dsptab"
import { Files } from "./filestab"
import { FiltersTab } from "./filterstab"
import { defaultGuiConfig, GuiConfig } from "./guiconfig"
import { UndoRedo } from "./main/UndoRedo"
import { MixersTab } from "./mixerstab"
import { PipelineTab } from "./pipeline/pipelinetab"
import { FilePlayback } from "./playbacktab"
import { ProcessorsTab } from "./processorstab"
import { Shortcuts } from "./shortcuts"
import { SidePanel } from "./sidepanel/sidepanel"
import { TitleTab } from "./titletab"
import { Update } from "./utilities/common"
import { Errors, NoErrors } from "./utilities/errors"
import { loadConfigJson, loadStartupConfig } from "./utilities/files"
import { delayedExecutor, ErrorBoundary, MdiButton, MdiIcon } from "./utilities/ui-components"

const customPageModules = import.meta.glob<{ default: CustomPageComponent }>("./custom-pages/*.tsx", { eager: true })
const customPages = Object.values(customPageModules)
  .map((m) => m.default)
  .filter((page) => page.enabled !== false)

class CamillaConfig extends React.Component<
  unknown,
  {
    activetab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    undoRedo: UndoRedo<Config>
    errors: Errors
    viewMode: ViewMode
    message: string
    unsavedChanges: boolean
    unappliedChanges: boolean
    controllerStatus: ControllerStatus | null
    controllerSettings: ControllerSettings | null
    /** Whether processing is stopped, as the side panel saw it with the controller status. */
    dspInactive: boolean
  }
> {
  constructor(props: unknown) {
    super(props)
    this.updateConfig = this.updateConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setCurrentConfigFileName = this.setCurrentConfigFileName.bind(this)
    this.openConfigFile = this.openConfigFile.bind(this)
    this.revertConfig = this.revertConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.switchTab = this.switchTab.bind(this)
    this.setViewMode = this.setViewMode.bind(this)
    this.NormalContent = this.NormalContent.bind(this)
    this.saveNotify = this.saveNotify.bind(this)
    this.applyNotify = this.applyNotify.bind(this)
    this.state = {
      activetab: 1,
      guiConfig: defaultGuiConfig(),
      undoRedo: new UndoRedo(defaultConfig()),
      errors: NoErrors,
      viewMode: getViewMode(),
      message: "",
      unsavedChanges: false,
      unappliedChanges: true,
      controllerStatus: null,
      controllerSettings: null,
      dspInactive: false,
    }
    this.loadGuiConfig()
    this.loadConfigAtStart()
  }

  private async loadGuiConfig() {
    try {
      const { data, error, response } = await api.GET("/api/guiconfig")
      if (data) this.setState({ guiConfig: data })
      else console.log("Failed to fetch guiconfig", errorMessage(error, response))
    } catch (err) {
      console.log("Failed to fetch guiconfig", err)
    }
  }

  private async loadConfigAtStart() {
    try {
      await this.loadRunningConfig()
    } catch (err) {
      console.log("Failed getting active config:", err)
    }
  }

  /**
   * Load what CamillaDSP runs into the editor, under the name of the file it came from. While it
   * runs the active config adapted to the source, that is the file, so that saving can't write the
   * adapted rate into it. Without a running config, the active or default file.
   */
  private async loadRunningConfig() {
    const json = await loadStartupConfig()
    const name = json.config_file_name ?? undefined
    let message = ""
    if (json.source === "dsp") message = "Loaded the config CamillaDSP runs"
    else if (json.source === "adapted")
      message = `Loaded ${name}, which CamillaDSP runs adapted to ${json.adapted_to_samplerate} Hz`
    else if (json.source === "active") message = "Loaded the active config"
    else if (json.source === "default") message = "Loaded the default config"
    else if (json.source === "fileless")
      message = "Loaded the file-less config CamillaDSP runs, it is not saved to any file"
    this.setState({
      unsavedChanges: false,
      // Only the config CamillaDSP runs as it is equals the editor's.
      unappliedChanges: json.source !== "dsp",
      currentConfigFile: name,
      undoRedo: new UndoRedo(json.config),
      message,
    })
  }

  private async fetchConfig() {
    try {
      await this.loadRunningConfig()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ message })
      throw err
    }
  }

  private setViewMode(mode: ViewMode) {
    setViewMode(mode)
    this.setState({ viewMode: mode })
  }

  private saveNotify() {
    this.setState({ unsavedChanges: false })
  }

  private applyNotify() {
    this.setState({ unappliedChanges: false })
  }

  private readonly saveTimer = delayedExecutor(100)

  private updateConfig(update: Update<Config>, saveAfterDelay: boolean = false) {
    this.setState(
      (prevState) => {
        const newConfig = cloneDeep(prevState.undoRedo.current())
        update(newConfig)
        let unsavedChanges = true
        let unappliedChanges = true
        if (isEqual(newConfig, prevState.undoRedo.current())) {
          unsavedChanges = prevState.unsavedChanges
          unappliedChanges = prevState.unappliedChanges
        }
        return {
          unsavedChanges: unsavedChanges,
          unappliedChanges: unappliedChanges,
          undoRedo: prevState.undoRedo.changeTo(newConfig),
        }
      },
      () => {
        if (saveAfterDelay) this.saveTimer(this.applyConfig)
      },
    )
  }

  private async applyConfig(): Promise<void> {
    this.applyConfigRequest(this.state.undoRedo.current())
  }

  private async applyConfigRequest(config: Config): Promise<void> {
    const { error, response } = await api.POST("/api/setconfig", { body: { config } })
    const message = error ? errorMessage(error, response) : "OK"
    this.setState({ message: message, unappliedChanges: false })
    if (error) throw new Error(message)
  }

  private async saveConfig() {
    if (this.state.currentConfigFile) {
      const { error, response } = await api.POST("/api/saveconfigfile", {
        body: {
          filename: this.state.currentConfigFile,
          config: this.state.undoRedo.current(),
        },
      })
      const message = error ? errorMessage(error, response) : "OK"
      this.setState({ message: message, unsavedChanges: false })
      if (error) throw new Error(message)
    }
  }

  /**
   * Run a config file from files, following the source as before, and load it into the editor.
   * For the quick config switch, which picks a file rather than a config to apply.
   */
  private async runConfigFile(filename: string, config: Config) {
    const { error, response } = await api.POST("/api/runfromfiles", { body: { file: filename, follow: null } })
    if (error) {
      this.setState({ message: errorMessage(error, response) })
      return
    }
    this.setCurrentConfig(filename, config)
    this.setState({ message: `Running ${filename} from files`, unappliedChanges: false })
  }

  private setCurrentConfig(filename: string | undefined, config: Config) {
    this.setState({
      unsavedChanges: false,
      unappliedChanges: true,
      currentConfigFile: filename,
      undoRedo: new UndoRedo(config),
    })
  }

  /** Load the editor's file again, dropping the changes. */
  private async revertConfig() {
    const name = this.state.currentConfigFile
    if (!name) return
    const config = await loadConfigJson(name, (reason) => this.setState({ message: reason }))
    this.setCurrentConfig(name, config)
    this.setState({ message: `Reverted to ${name}` })
  }

  /** Load a config file into the editor, and show its devices. */
  private async openConfigFile(name: string) {
    const config = await loadConfigJson(name, (reason) => this.setState({ message: reason }))
    this.setCurrentConfig(name, config)
    this.setState({ activetab: 2, message: `Opened ${name}` })
  }

  private setCurrentConfigFileName(filename: string | undefined) {
    this.setState({
      currentConfigFile: filename,
    })
  }

  private setErrors(errors: Errors) {
    this.setState({ errors: errors })
  }

  componentDidUpdate() {
    //ReactTooltip.rebuild()
    document.title = this.state.guiConfig.page_title
  }

  componentDidMount() {
    document.title = this.state.guiConfig.page_title
  }

  private switchTab(index: number) {
    this.setState({ activetab: index })
  }

  render() {
    return (
      <div className="configapp">
        <Tooltip id="main-tooltip" className="tooltip" border="var(--box-border)" />
        {this.state.viewMode === "compact" ? (
          <CompactView
            currentConfigName={this.state.currentConfigFile}
            config={this.state.undoRedo.current()}
            setConfig={(filename, config) => {
              this.runConfigFile(filename, config).catch(() => {})
            }}
            updateConfig={(update) => this.updateConfig(update, true)}
            switchToNormalView={() => this.setViewMode("normal")}
            switchToDashboardView={() => this.setViewMode("dashboard")}
            guiConfig={this.state.guiConfig}
          />
        ) : this.state.viewMode === "dashboard" ? (
          <DashboardView
            guiConfig={this.state.guiConfig}
            message={this.state.message}
            switchToNormalView={() => this.setViewMode("normal")}
            switchToCompactView={() => this.setViewMode("compact")}
          />
        ) : (
          <this.NormalContent />
        )}
      </div>
    )
  }

  private NormalContent() {
    const { errors, undoRedo, currentConfigFile } = this.state
    const config = undoRedo.current()
    return (
      <>
        <SidePanel
          currentConfigFile={currentConfigFile}
          config={config}
          guiConfig={this.state.guiConfig}
          applyConfig={this.applyConfig}
          fetchConfig={this.fetchConfig}
          saveConfig={this.saveConfig}
          revertConfig={this.revertConfig}
          setErrors={this.setErrors}
          onControllerStatus={(controllerStatus, controllerSettings, dspInactive) =>
            this.setState((prev) => ({
              controllerStatus,
              controllerSettings,
              dspInactive,
              // CamillaDSP went back to files, so it no longer runs the config applied from the
              // editor.
              unappliedChanges:
                prev.unappliedChanges || (isFileless(prev.controllerStatus) && !isFileless(controllerStatus)),
            }))
          }
          message={this.state.message}
          unsavedChanges={this.state.unsavedChanges}
          unappliedChanges={this.state.unappliedChanges}
        />
        <Tabs className="configtabs" selectedIndex={this.state.activetab} onSelect={this.switchTab}>
          <TabList>
            <Tab disabled={true}>
              <MdiButton
                icon={mdiPoll}
                tooltip="Change to dashboard view"
                onClick={() => this.setViewMode("dashboard")}
                buttonSize="tiny"
                rotation={90}
              />
              <MdiButton
                icon={mdiImageSizeSelectSmall}
                tooltip="Change to compact view"
                onClick={() => this.setViewMode("compact")}
                buttonSize="tiny"
              />
              <MdiButton
                icon={mdiArrowULeftTop}
                tooltip={"Undo last change<br>" + undoRedo.undoDiff()}
                buttonSize="tiny"
                style={{
                  marginLeft: "10px",
                  marginRight: "10px",
                }}
                onClick={() =>
                  this.setState((prevState) => ({
                    undoRedo: prevState.undoRedo.undo(),
                  }))
                }
                enabled={undoRedo.canUndo()}
              />
              <MdiButton
                icon={mdiArrowURightTop}
                tooltip={"Redo last change<br>" + undoRedo.redoDiff()}
                buttonSize="tiny"
                onClick={() =>
                  this.setState((prevState) => ({
                    undoRedo: prevState.undoRedo.redo(),
                  }))
                }
                enabled={undoRedo.canRedo()}
              />
            </Tab>
            <Tab>Title</Tab>
            <Tab>Devices {errors.hasErrorsFor("devices") && <ErrorIcon />}</Tab>
            <Tab>Filters {errors.hasErrorsFor("filters") && <ErrorIcon />}</Tab>
            <Tab>Mixers {errors.hasErrorsFor("mixers") && <ErrorIcon />}</Tab>
            <Tab>Processors {errors.hasErrorsFor("processors") && <ErrorIcon />}</Tab>
            <Tab>Pipeline {errors.hasErrorsFor("pipeline") && <ErrorIcon />}</Tab>
            <Tab>Files</Tab>
            <Tab>CamillaDSP</Tab>
            {this.state.guiConfig.audiofiles_supported && <Tab>File playback</Tab>}
            <Tab>Shortcuts</Tab>
            {customPages.map((customPage) => (
              <Tab key={customPage.tabLabel}>{customPage.tabLabel}</Tab>
            ))}
          </TabList>
          <TabPanel />
          <TabPanel>
            <TitleTab config={config} updateConfig={this.updateConfig} />
          </TabPanel>
          <TabPanel>
            <DevicesTab
              devices={config.devices}
              guiConfig={this.state.guiConfig}
              updateConfig={this.updateConfig}
              errors={errors.forSubpath("devices")}
            />
          </TabPanel>
          <TabPanel>
            <FiltersTab
              config={config}
              samplerate={config.devices.samplerate}
              channels={getCaptureDeviceChannelCount(config.devices.capture)}
              coeffDir={this.state.guiConfig.coeff_dir}
              allowAbsolutePaths={this.state.guiConfig.allow_absolute_paths}
              updateConfig={this.updateConfig}
              errors={errors.forSubpath("filters")}
            />
          </TabPanel>
          <TabPanel>
            <MixersTab config={config} updateConfig={this.updateConfig} errors={errors.forSubpath("mixers")} />
          </TabPanel>
          <TabPanel>
            <ProcessorsTab config={config} updateConfig={this.updateConfig} errors={errors.forSubpath("processors")} />
          </TabPanel>
          <TabPanel>
            <PipelineTab config={config} updateConfig={this.updateConfig} errors={errors.forSubpath("pipeline")} />
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
              controllerStatus={this.state.controllerStatus}
            />
          </TabPanel>
          <TabPanel>
            <DspTab
              status={this.state.controllerStatus}
              settings={this.state.controllerSettings}
              inactive={this.state.dspInactive}
              openConfigFile={this.openConfigFile}
            />
          </TabPanel>
          {this.state.guiConfig.audiofiles_supported && (
            <TabPanel>
              <FilePlayback loadConfig={(config) => this.setCurrentConfig(undefined, config)} />
            </TabPanel>
          )}
          <TabPanel>
            <Shortcuts
              currentConfigName={currentConfigFile}
              config={this.state.undoRedo.current()}
              setConfig={(filename, config) => {
                this.runConfigFile(filename, config).catch(() => {})
              }}
              updateConfig={(update) => this.updateConfig(update, true)}
              shortcutSections={this.state.guiConfig.custom_shortcuts}
            />
          </TabPanel>
          {customPages.map((customPage) => {
            const CustomPage = customPage
            return (
              <TabPanel key={CustomPage.tabLabel}>
                <ErrorBoundary>
                  <CustomPage
                    config={config}
                    updateConfig={this.updateConfig}
                    guiConfig={this.state.guiConfig}
                    errors={errors}
                  />
                </ErrorBoundary>
              </TabPanel>
            )
          })}
        </Tabs>
      </>
    )
  }
}

function ErrorIcon() {
  return <MdiIcon icon={mdiAlert} tooltip="There are errors on this tab" style={{ color: "var(--error-text-color)" }} />
}

const container = document.getElementById("root")
installDemoBackend()
const root = createRoot(container!)
root.render(<CamillaConfig />)
