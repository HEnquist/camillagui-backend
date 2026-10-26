/* The CSS files have to be imported in exactly this order.
   Otherwise the custom react-tabs styles in index.css don't work */
import "react-tabs/style/react-tabs.css"
import "react-tooltip/dist/react-tooltip.css"
import "./index.css"

import * as React from "react"
import { mdiAlert } from "@mdi/js"
import { cloneDeep } from "lodash"
import isEqual from "lodash/isEqual"
import { createRoot } from "react-dom/client"
import { Tab, TabList, TabPanel, Tabs } from "react-tabs"
import { api, errorMessage } from "./api/client"
import { Area, getArea, storeArea } from "./areas"
import { Config, defaultConfig, getCaptureDeviceChannelCount } from "./camilladsp/config"
import { ControllerSettings, ControllerStatus, isFileless, StartupArgs } from "./camilladsp/status"
import { ConfigsTab, OverviewTab } from "./controltabs"
import type { CustomPageComponent } from "./custom-pages/types"
import { installDemoBackend } from "./demo/mockBackend"
import { DevicesTab } from "./devicestab"
import { EditorToolbar } from "./editortoolbar"
import { Files } from "./filestab"
import { FiltersTab } from "./filterstab"
import { defaultGuiConfig, GuiConfig } from "./guiconfig"
import { UndoRedo } from "./main/UndoRedo"
import { MixersTab } from "./mixerstab"
import { PipelineTab } from "./pipeline/pipelinetab"
import { FilePlayback } from "./playbacktab"
import { ProcessorsTab } from "./processorstab"
import { Shortcuts } from "./shortcuts"
import camillalogo from "./sidepanel/camilladsp.svg"
import { SidePanel } from "./sidepanel/sidepanel"
import { TitleTab } from "./titletab"
import { Update } from "./utilities/common"
import { Errors, NoErrors } from "./utilities/errors"
import { loadConfigJson, loadStartupConfig } from "./utilities/files"
import { delayedExecutor, ErrorBoundary, MainTooltip, MdiIcon } from "./utilities/ui-components"

const customPageModules = import.meta.glob<{ default: CustomPageComponent }>("./custom-pages/*.tsx", { eager: true })
const customPages = Object.values(customPageModules)
  .map((m) => m.default)
  .filter((page) => page.enabled !== false)

class CamillaConfig extends React.Component<
  unknown,
  {
    area: Area
    controlTab: number
    /** The Edit area's tab, where 0 is Title. */
    editTab: number
    currentConfigFile?: string
    guiConfig: GuiConfig
    undoRedo: UndoRedo<Config>
    errors: Errors
    message: string
    unsavedChanges: boolean
    unappliedChanges: boolean
    /**
     * Save the editor's config to its file, and apply it to CamillaDSP, after each change. Kept
     * here rather than in the toolbar, so that they carry on while the Control area is shown.
     */
    saveConfigAutomatically: boolean
    applyConfigAutomatically: boolean
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
    this.saveConfigAs = this.saveConfigAs.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.setCurrentConfig = this.setCurrentConfig.bind(this)
    this.openConfigFile = this.openConfigFile.bind(this)
    this.revertConfig = this.revertConfig.bind(this)
    this.setErrors = this.setErrors.bind(this)
    this.setArea = this.setArea.bind(this)
    this.ControlArea = this.ControlArea.bind(this)
    this.EditArea = this.EditArea.bind(this)
    this.applyNotify = this.applyNotify.bind(this)
    this.state = {
      area: getArea(),
      controlTab: 0,
      editTab: 0,
      guiConfig: defaultGuiConfig(),
      undoRedo: new UndoRedo(defaultConfig()),
      errors: NoErrors,
      message: "",
      unsavedChanges: false,
      unappliedChanges: true,
      saveConfigAutomatically: defaultGuiConfig().save_config_automatically,
      applyConfigAutomatically: defaultGuiConfig().apply_config_automatically,
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
      if (data)
        this.setState({
          guiConfig: data,
          saveConfigAutomatically: data.save_config_automatically,
          applyConfigAutomatically: data.apply_config_automatically,
        })
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

  /** Save the editor's config to a file, which becomes the editor's file. */
  private async saveConfigAs(filename: string) {
    const { error, response } = await api.POST("/api/saveconfigfile", {
      body: { filename, config: this.state.undoRedo.current() },
    })
    if (error) {
      const message = errorMessage(error, response)
      this.setState({ message })
      throw new Error(message)
    }
    this.setState({ currentConfigFile: filename, unsavedChanges: false, message: `Saved as ${filename}` })
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
    this.setState({ area: "edit", editTab: 1, message: `Opened ${name}` })
  }

  private setErrors(errors: Errors) {
    this.setState({ errors: errors })
  }

  private readonly autoSaveTimer = delayedExecutor(500)
  private readonly autoApplyTimer = delayedExecutor(500)

  componentDidUpdate(_prevProps: unknown, prevState: { undoRedo: UndoRedo<Config> }) {
    //ReactTooltip.rebuild()
    document.title = this.state.guiConfig.page_title
    if (isEqual(prevState.undoRedo.current(), this.state.undoRedo.current())) return
    if (this.state.saveConfigAutomatically)
      this.autoSaveTimer(() => {
        this.saveConfig().catch(() => {})
      })
    // Applying never leaves files, only a file-less config follows the editor. Without a
    // controller there are no files to leave.
    const controller = this.state.controllerStatus
    if (this.state.applyConfigAutomatically && (!controller || isFileless(controller)))
      this.autoApplyTimer(() => {
        this.applyConfig().catch(() => {})
      })
  }

  componentDidMount() {
    document.title = this.state.guiConfig.page_title
  }

  private switchTab(tab: "controlTab" | "editTab", index: number) {
    // On a narrow window the tab list scrolls sideways, keep the selected tab in view
    this.setState({ [tab]: index } as Pick<typeof this.state, typeof tab>, () =>
      document.querySelector(".react-tabs__tab--selected")?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    )
  }

  render() {
    const { area } = this.state
    return (
      <div className="configapp configapp-normal">
        <MainTooltip />
        <SidePanel
          guiConfig={this.state.guiConfig}
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
        />
        <div className="mainarea">
          <div className="mainarea-header">
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
            <img className="mainarea-logo" src={camillalogo} alt="CamillaDSP" />
          </div>
          {area === "control" ? <this.ControlArea /> : <this.EditArea />}
        </div>
      </div>
    )
  }

  /**
   * What CamillaDSP does and runs: the overview, the configs, the files available to it, shortcuts,
   * playback, and the custom pages.
   */
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
        className="configtabs"
        selectedIndex={this.state.controlTab}
        onSelect={(index) => this.switchTab("controlTab", index)}
      >
        <TabList>
          <Tab>Overview</Tab>
          <Tab>Configs</Tab>
          <Tab>Files</Tab>
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
          <Files
            currentConfigFile={currentConfigFile}
            config={config}
            setCurrentConfig={this.setCurrentConfig}
            showEditor={() => this.setArea("edit")}
            guiConfig={guiConfig}
            controllerStatus={this.state.controllerStatus}
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

  /**
   * The config editor: the toolbar with its file, saving, history and the way to CamillaDSP, and
   * the tabs for each part of the config.
   */
  private EditArea() {
    const { errors, undoRedo } = this.state
    const config = undoRedo.current()
    return (
      <div className="edit-area">
        <EditorToolbar
          config={config}
          currentConfigFile={this.state.currentConfigFile}
          controller={this.state.controllerStatus}
          unsavedChanges={this.state.unsavedChanges}
          unappliedChanges={this.state.unappliedChanges}
          message={this.state.message}
          canUndo={undoRedo.canUndo()}
          canRedo={undoRedo.canRedo()}
          undoDiff={undoRedo.undoDiff()}
          redoDiff={undoRedo.redoDiff()}
          undo={() => this.setState((prevState) => ({ undoRedo: prevState.undoRedo.undo() }))}
          redo={() => this.setState((prevState) => ({ undoRedo: prevState.undoRedo.redo() }))}
          saveConfig={this.saveConfig}
          revertConfig={this.revertConfig}
          saveConfigAs={this.saveConfigAs}
          setCurrentConfig={this.setCurrentConfig}
          updateConfig={this.updateConfig}
          setErrors={this.setErrors}
          saveAutomatically={this.state.saveConfigAutomatically}
          setSaveAutomatically={(on) => this.setState({ saveConfigAutomatically: on })}
          applyConfig={this.applyConfig}
          fetchConfig={this.fetchConfig}
          applyAutomatically={this.state.applyConfigAutomatically}
          setApplyAutomatically={(on) => this.setState({ applyConfigAutomatically: on })}
        />
        <Tabs
          className="configtabs"
          selectedIndex={this.state.editTab}
          onSelect={(index) => this.switchTab("editTab", index)}
        >
          <TabList>
            <Tab>Title</Tab>
            <Tab>Devices {errors.hasErrorsFor("devices") && <ErrorIcon />}</Tab>
            <Tab>Filters {errors.hasErrorsFor("filters") && <ErrorIcon />}</Tab>
            <Tab>Mixers {errors.hasErrorsFor("mixers") && <ErrorIcon />}</Tab>
            <Tab>Processors {errors.hasErrorsFor("processors") && <ErrorIcon />}</Tab>
            <Tab>Pipeline {errors.hasErrorsFor("pipeline") && <ErrorIcon />}</Tab>
          </TabList>
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
        </Tabs>
      </div>
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
