/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css"
import "react-tooltip/dist/react-tooltip.css"
import "./index.css"

import * as React from "react"
import { mdiAlert, mdiArrowULeftTop, mdiArrowURightTop } from "@mdi/js"
import { cloneDeep } from "lodash"
import isEqual from "lodash/isEqual"
import { createRoot } from "react-dom/client"
import { Tab, TabList, TabPanel, Tabs } from "react-tabs"
import { Tooltip } from "react-tooltip"
import { api, errorMessage } from "./api/client"
import { Area, getArea, storeArea } from "./areas"
import { Config, defaultConfig, getCaptureDeviceChannelCount } from "./camilladsp/config"
import { ControllerSettings, ControllerStatus, isFileless, StartupArgs } from "./camilladsp/status"
import { ConfigsTab, OverviewTab } from "./controltabs"
import type { CustomPageComponent } from "./custom-pages/types"
import { installDemoBackend } from "./demo/mockBackend"
import { DevicesTab } from "./devicestab"
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
    area: Area
    controlTab: number
    /** The Edit area's tab, where 0 is the undo and redo buttons and 1 is Title. */
    editTab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    undoRedo: UndoRedo<Config>
    errors: Errors
    message: string
    unsavedChanges: boolean
    unappliedChanges: boolean
    controllerStatus: ControllerStatus | null
    controllerSettings: ControllerSettings | null
    startupArgs: StartupArgs | null
    /** Whether processing is stopped, as the side panel saw it with the controller status. */
    dspInactive: boolean
  }
> {
  constructor(props: unknown) {
    super(props)
    this.updateConfig = this.updateConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.runConfigFile = this.runConfigFile.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.setCurrentConfigFileName = this.setCurrentConfigFileName.bind(this)
    this.openConfigFile = this.openConfigFile.bind(this)
    this.revertConfig = this.revertConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.setArea = this.setArea.bind(this)
    this.ControlArea = this.ControlArea.bind(this)
    this.EditArea = this.EditArea.bind(this)
    this.saveNotify = this.saveNotify.bind(this)
    this.applyNotify = this.applyNotify.bind(this)
    this.state = {
      area: getArea(),
      controlTab: 0,
      editTab: 1,
      guiConfig: defaultGuiConfig(),
      undoRedo: new UndoRedo(defaultConfig()),
      errors: NoErrors,
      message: "",
      unsavedChanges: false,
      unappliedChanges: true,
      controllerStatus: null,
      controllerSettings: null,
      startupArgs: null,
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
    else if (json.source === "active") message = "Loaded the startup config"
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

  private setArea(area: Area) {
    storeArea(area)
    this.setState({ area })
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
   * Run a config file from files, following the source as before, and load it into the editor, so
   * that the shortcuts work on what runs. For the config files in Configs, which pick a file
   * rather than a config to apply. Throws with the message when CamillaDSP refuses.
   */
  private async runConfigFile(filename: string) {
    const config = await loadConfigJson(filename)
    const { error, response } = await api.POST("/api/runfromfiles", { body: { file: filename, follow: null } })
    if (error) throw new Error(errorMessage(error, response))
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
    storeArea("edit")
    this.setState({ area: "edit", editTab: 2, message: `Opened ${name}` })
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

  render() {
    const { area, currentConfigFile } = this.state
    return (
      <div className="configapp">
        <Tooltip id="main-tooltip" className="tooltip" border="var(--box-border)" />
        <SidePanel
          editing={area === "edit"}
          currentConfigFile={currentConfigFile}
          config={this.state.undoRedo.current()}
          guiConfig={this.state.guiConfig}
          applyConfig={this.applyConfig}
          fetchConfig={this.fetchConfig}
          saveConfig={this.saveConfig}
          revertConfig={this.revertConfig}
          setErrors={this.setErrors}
          onControllerStatus={(controllerStatus, controllerSettings, startupArgs, dspInactive) =>
            this.setState((prev) => ({
              controllerStatus,
              controllerSettings,
              startupArgs,
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
        <div className="mainarea">
          <div className="area-switch" role="tablist">
            {AREAS.map(([key, label, tooltip]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={area === key}
                className={area === key ? "area-tab area-tab-selected" : "area-tab"}
                data-tooltip-html={tooltip}
                data-tooltip-id="main-tooltip"
                onClick={() => this.setArea(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {area === "control" ? <this.ControlArea /> : <this.EditArea />}
        </div>
      </div>
    )
  }

  /** What CamillaDSP does and runs: the overview, the configs, shortcuts, playback, custom pages. */
  private ControlArea() {
    const { guiConfig, currentConfigFile, errors } = this.state
    const config = this.state.undoRedo.current()
    const controller = {
      status: this.state.controllerStatus,
      settings: this.state.controllerSettings,
      startupArgs: this.state.startupArgs,
      openConfigFile: this.openConfigFile,
    }
    return (
      <Tabs
        className="controltabs"
        selectedIndex={this.state.controlTab}
        onSelect={(index) => this.setState({ controlTab: index })}
      >
        <TabList>
          <Tab>Overview</Tab>
          <Tab>Configs</Tab>
          <Tab>Shortcuts</Tab>
          {guiConfig.audiofiles_supported && <Tab>File playback</Tab>}
          {customPages.map((customPage) => (
            <Tab key={customPage.tabLabel}>{customPage.tabLabel}</Tab>
          ))}
        </TabList>
        <TabPanel>
          <OverviewTab {...controller} guiConfig={guiConfig} inactive={this.state.dspInactive} />
        </TabPanel>
        <TabPanel>
          <ConfigsTab
            {...controller}
            canChooseFile={guiConfig.can_update_active_config}
            currentConfigName={currentConfigFile}
            runConfigFile={this.runConfigFile}
          />
        </TabPanel>
        <TabPanel>
          <Shortcuts
            config={config}
            updateConfig={(update) => this.updateConfig(update, true)}
            shortcutSections={guiConfig.custom_shortcuts}
          />
        </TabPanel>
        {guiConfig.audiofiles_supported && (
          <TabPanel>
            <FilePlayback loadConfig={(config) => this.setCurrentConfig(undefined, config)} />
          </TabPanel>
        )}
        {customPages.map((customPage) => {
          const CustomPage = customPage
          return (
            <TabPanel key={CustomPage.tabLabel}>
              <ErrorBoundary>
                <CustomPage config={config} updateConfig={this.updateConfig} guiConfig={guiConfig} errors={errors} />
              </ErrorBoundary>
            </TabPanel>
          )
        })}
      </Tabs>
    )
  }

  /** The config editor: undo and redo, the tabs for each part of the config, and the files. */
  private EditArea() {
    const { errors, undoRedo, currentConfigFile } = this.state
    const config = undoRedo.current()
    return (
      <Tabs
        className="configtabs"
        selectedIndex={this.state.editTab}
        onSelect={(index) => this.setState({ editTab: index })}
      >
        <TabList>
          <Tab disabled={true}>
            <MdiButton
              icon={mdiArrowULeftTop}
              tooltip={"Undo last change<br>" + undoRedo.undoDiff()}
              buttonSize="tiny"
              style={{
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
      </Tabs>
    )
  }
}

const AREAS: [Area, string, string][] = [
  ["control", "Control", "What CamillaDSP runs: the overview, the configs, shortcuts and playback"],
  ["edit", "Edit", "The config editor"],
]

function ErrorIcon() {
  return <MdiIcon icon={mdiAlert} tooltip="There are errors on this tab" style={{ color: "var(--error-text-color)" }} />
}

const container = document.getElementById("root")
installDemoBackend()
const root = createRoot(container!)
root.render(<CamillaConfig />)
