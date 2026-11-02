import React from "react"
import "../index.css"
import { mdiClose, mdiMenu, mdiScaleUnbalanced } from "@mdi/js"
import isEqual from "lodash/isEqual"
import { AuxFadersBox } from "./auxfaderbox"
import camillalogo from "./camilladsp.svg"
import { CdspStateBox } from "./cdspstatebox"
import { Configcheckmessage } from "./configcheckmessage"
import { VolumeBox } from "./volumebox"
import { api, errorMessage } from "../api/client"
import { Config } from "../camilladsp/config"
import { defaultStatus, isBackendOnline, isCdspOnline, isCdspRunning, Status, StatusPoller } from "../camilladsp/status"
import { VersionLabels } from "../camilladsp/versions"
import { GuiConfig } from "../guiconfig"
import { DiffPopup } from "../utilities/diffpopup"
import { Errors } from "../utilities/errors"
import { Box, delayedExecutor, SuccessFailureButton, MdiButton } from "../utilities/ui-components"

interface SidePanelProps {
  config: Config
  guiConfig: GuiConfig
  applyConfig: () => Promise<void>
  fetchConfig: () => Promise<void>
  saveConfig: () => Promise<void>
  saveAndApplyConfig: () => Promise<void>
  setErrors: (errors: Errors) => void
  currentConfigFile?: string
  message: string
  unsavedChanges: boolean
  unappliedChanges: boolean
}

export class SidePanel extends React.Component<
  SidePanelProps,
  {
    cdspStatus: Status
    applyConfigAutomatically: boolean
    saveConfigAutomatically: boolean
    msg: string
    diffConfigDSP: Config
    diffConfigGUI: Config
    showDiffPopup: boolean
    drawerOpen: boolean
  }
> {
  private statusPoller = new StatusPoller(
    (cdspStatus) => this.setState({ cdspStatus }),
    this.props.guiConfig.status_update_interval,
  )

  private applyTimer = delayedExecutor(500)
  private saveTimer = delayedExecutor(500)

  constructor(props: SidePanelProps) {
    super(props)
    this.state = {
      cdspStatus: defaultStatus(),
      applyConfigAutomatically: props.guiConfig.apply_config_automatically,
      saveConfigAutomatically: props.guiConfig.save_config_automatically,
      msg: "",
      diffConfigDSP: {} as Config,
      diffConfigGUI: {} as Config,
      showDiffPopup: false,
      drawerOpen: false,
    }
  }

  componentWillUnmount() {
    this.statusPoller.stop()
  }

  componentDidUpdate(prevProps: SidePanelProps) {
    const { apply_config_automatically, save_config_automatically } = this.props.guiConfig
    if (apply_config_automatically !== prevProps.guiConfig.apply_config_automatically)
      this.setState({
        applyConfigAutomatically: apply_config_automatically,
      })
    if (save_config_automatically !== prevProps.guiConfig.save_config_automatically)
      this.setState({
        saveConfigAutomatically: save_config_automatically,
      })
    const { status_update_interval } = this.props.guiConfig
    if (status_update_interval !== prevProps.guiConfig.status_update_interval)
      this.statusPoller.setInterval(status_update_interval)
    if (this.state.applyConfigAutomatically && !isEqual(prevProps.config, this.props.config))
      this.applyTimer(() => {
        this.props.applyConfig().catch(() => {})
      })
    if (this.state.saveConfigAutomatically && !isEqual(prevProps.config, this.props.config))
      this.saveTimer(() => {
        this.props.saveConfig().catch(() => {})
      })
    // TODO save
  }

  render() {
    const { drawerOpen } = this.state
    const closeDrawer = () => this.setState({ drawerOpen: false })
    return (
      <>
        <div className="status-strip">
          <MdiButton
            icon={mdiMenu}
            tooltip="Show the side panel"
            buttonSize="small"
            onClick={() => this.setState({ drawerOpen: true })}
          />
          <span>State: {this.state.cdspStatus.cdsp_status}</span>
          <SaveApplyIndicators unsaved={this.props.unsavedChanges} unapplied={this.props.unappliedChanges} />
        </div>
        <div className={"drawer-backdrop" + (drawerOpen ? " drawer-backdrop-open" : "")} onClick={closeDrawer} />
        <section className={"sidepanel" + (drawerOpen ? " sidepanel-open" : "")}>
          {this.panelContent(closeDrawer)}
        </section>
      </>
    )
  }

  private panelContent(closeDrawer: () => void) {
    return (
      <>
        <div className="sidepanel-header">
          <div className="sidepanel-header-main">
            <img className="sidepanel-logo" src={camillalogo} alt="graph" />
          </div>
          <MdiButton
            icon={mdiClose}
            tooltip="Hide the side panel"
            buttonSize="small"
            className="drawer-close"
            onClick={closeDrawer}
          />
        </div>
        <div className="sidepanel-content">
          {isCdspOnline(this.state.cdspStatus) && (
            <VolumeBox
              setMessage={(message) => this.setState({ msg: message })}
              inputLabels={this.state.cdspStatus.labels.capture}
              outputLabels={this.state.cdspStatus.labels.playback}
              guiConfig={this.props.guiConfig}
              meterSize={{ width: 290, channelHeight: 10 }}
              isRunning={isCdspRunning(this.state.cdspStatus)}
            />
          )}
          {isCdspOnline(this.state.cdspStatus) && <AuxFadersBox guiConfig={this.props.guiConfig} />}
          <CdspStateBox status={this.state.cdspStatus} message={this.props.message} />
          {this.configBox()}
          <VersionLabels versions={this.state.cdspStatus} />
        </div>
        <DiffPopup
          open={this.state.showDiffPopup}
          onClose={() => this.setState({ showDiffPopup: false })}
          left_config={this.state.diffConfigDSP}
          left_name="DSP"
          right_config={this.state.diffConfigGUI}
          right_name="GUI"
        />
      </>
    )
  }

  private configBox() {
    const status = this.state.cdspStatus
    const cdsp_online = isCdspOnline(status)
    const activeConfigFile = this.props.currentConfigFile
    const activeConfigSelected = Boolean(activeConfigFile)
    const unsaved = this.props.unsavedChanges
    const unapplied = this.props.unappliedChanges

    const fetchEnabled = cdsp_online
    const applyEnabled = cdsp_online && !this.state.applyConfigAutomatically
    const saveEnabled = isBackendOnline(status) && activeConfigSelected && !this.state.saveConfigAutomatically
    const applyAndSaveEnabled =
      cdsp_online && !this.state.applyConfigAutomatically && !this.state.saveConfigAutomatically && activeConfigSelected
    //let applyButtonText = 'Apply to DSP'
    let saveButtonTooltip = "No active file selected"
    if (activeConfigFile) saveButtonTooltip = `Save to active config file: ${activeConfigFile}`
    return (
      <Box
        title={
          <>
            Config
            <MdiButton
              icon={mdiScaleUnbalanced}
              tooltip={`Compare configs in DSP and GUI`}
              enabled={true}
              onClick={() => this.compareConfig()}
              buttonSize="small"
            />
          </>
        }
      >
        <div
          style={{
            width: "220px",
            overflowWrap: "break-word",
            textAlign: "center",
            margin: "0 auto 5px",
          }}
        >
          {activeConfigFile ? activeConfigFile : "(no config selected as active)"}
        </div>
        <div className="two-column-grid">
          <SuccessFailureButton
            enabled={fetchEnabled}
            text="Fetch from DSP"
            tooltip="Fetch active config from<br>the running CamillaDSP process"
            onClick={this.props.fetchConfig}
          />
          <SuccessFailureButton
            enabled={applyEnabled}
            text="Apply to DSP"
            tooltip="Apply config to the running<br>CamillaDSP process"
            onClick={this.props.applyConfig}
          />
          <SuccessFailureButton
            enabled={saveEnabled}
            text="Save to file"
            tooltip={saveButtonTooltip}
            onClick={this.props.saveConfig}
          />
          <SuccessFailureButton
            enabled={applyAndSaveEnabled}
            text="Apply and save"
            tooltip="Apply to DSP and save to file"
            onClick={this.props.saveAndApplyConfig}
          />
          <SuccessFailureButton
            enabled={cdsp_online}
            text="Stop processing"
            tooltip="Stop the DSP processing"
            onClick={() => this.stopProcessing()}
          />
        </div>
        <label
          className="setting"
          data-tooltip-html="Apply config to DSP automatically<br>after each change"
          data-tooltip-id="main-tooltip"
          style={{ marginTop: "5px" }}
        >
          <span className="setting-label-wide">Apply automatically</span>
          <input
            type="checkbox"
            checked={this.state.applyConfigAutomatically}
            onChange={(e) =>
              this.setState({
                applyConfigAutomatically: e.target.checked,
              })
            }
          />
        </label>
        <label
          className="setting"
          data-tooltip-html="Save config to file automatically<br>after each change"
          data-tooltip-id="main-tooltip"
        >
          <span className="setting-label-wide">Save automatically</span>
          <input
            type="checkbox"
            checked={this.state.saveConfigAutomatically}
            onChange={(e) =>
              this.setState({
                saveConfigAutomatically: e.target.checked,
              })
            }
          />
        </label>
        <div className="two-column-grid" style={{ textAlign: "center", marginTop: "5px" }}>
          <SaveApplyIndicators unsaved={unsaved} unapplied={unapplied} />
        </div>
        <Configcheckmessage config={this.props.config} setErrors={this.props.setErrors} />
      </Box>
    )
  }

  private async fetchDSPConfig() {
    const { data, error, response } = await api.GET("/api/getconfig")
    if (error) throw new Error(errorMessage(error, response))
    return data
  }

  private async stopProcessing() {
    const { error, response } = await api.POST("/api/stop")
    if (error) throw new Error(errorMessage(error, response))
  }

  private async compareConfig() {
    try {
      const dspConfig = await this.fetchDSPConfig()
      const guiConfig = this.props.config
      this.setState({
        showDiffPopup: true,
        diffConfigDSP: dspConfig as Config,
        diffConfigGUI: guiConfig,
      })
    } catch (e) {
      console.log(e)
    }
  }
}

function SaveApplyIndicators(props: { unsaved: boolean; unapplied: boolean }) {
  const { unsaved, unapplied } = props
  return (
    <>
      <span
        data-tooltip-html={
          unsaved ? "GUI has changes that have<br>not been saved to file" : "All changes have been saved to file"
        }
        data-tooltip-id="main-tooltip"
      >
        {unsaved ? "All saved: ⚠️" : "All saved: ✔️"}
      </span>
      <span
        data-tooltip-html={
          unapplied
            ? "GUI has changes that have<br>not been applied to the DSP"
            : "All changes have been applied to the DSP"
        }
        data-tooltip-id="main-tooltip"
      >
        {unapplied ? "All applied: ⚠️" : "All applied: ✔️"}
      </span>
    </>
  )
}
