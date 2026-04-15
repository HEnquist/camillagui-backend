import React from "react"
import "../index.css"
import { mdiHome, mdiImageSizeSelectSmall, mdiScaleUnbalanced } from "@mdi/js"
import isEqual from "lodash/isEqual"
import { AuxFadersBox } from "./auxfaderbox"
import camillalogo from "./camilladsp.svg"
import { Configcheckmessage } from "./configcheckmessage"
import { LogFileViewerPopup } from "./logfileviewer"
import { VolumeBox } from "./volumebox"
import { Config } from "../camilladsp/config"
import {
  defaultStatus,
  isBackendOnline,
  isCdspOnline,
  LevelsEvent,
  LevelsEventStream,
  Status,
  StatusWithLevels,
  StatusPoller,
} from "../camilladsp/status"
import { VersionLabels } from "../camilladsp/versions"
import { GuiConfig } from "../guiconfig"
import { DiffPopup } from "../utilities/diffpopup"
import { Errors } from "../utilities/errors"
import { Box, Button, delayedExecutor, SuccessFailureButton, MdiButton } from "../utilities/ui-components"
import { VuMeterSize } from "./vumeter"

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
  dashboardExpanded: boolean
  switchToNormalView: () => void
  switchToCompactView: () => void
}

export class SidePanel extends React.Component<
  SidePanelProps,
  {
    cdspStatus: StatusWithLevels
    applyConfigAutomatically: boolean
    saveConfigAutomatically: boolean
    msg: string
    dspConfigFileName: string | null
    logFileViewerOpen: boolean
    diffConfigDSP: Config
    diffConfigGUI: Config
    showDiffPopup: boolean
  }
> {
  private statusPoller = new StatusPoller(
    (cdspStatus) =>
      this.setState((prevState) => ({
        cdspStatus: {
          ...cdspStatus,
          capturesignalrms: prevState.cdspStatus.capturesignalrms,
          capturesignalpeak: prevState.cdspStatus.capturesignalpeak,
          playbacksignalrms: prevState.cdspStatus.playbacksignalrms,
          playbacksignalpeak: prevState.cdspStatus.playbacksignalpeak,
        },
      })),
    this.props.guiConfig.status_update_interval,
  )
  private levelsEventStream = new LevelsEventStream((event) => this.updateLevels(event))

  private applyTimer = delayedExecutor(500)
  private saveTimer = delayedExecutor(500)

  constructor(props: SidePanelProps) {
    super(props)
    this.state = {
      cdspStatus: defaultStatus(),
      applyConfigAutomatically: props.guiConfig.apply_config_automatically,
      saveConfigAutomatically: props.guiConfig.save_config_automatically,
      msg: "",
      dspConfigFileName: null,
      logFileViewerOpen: false,
      diffConfigDSP: {} as Config,
      diffConfigGUI: {} as Config,
      showDiffPopup: false,
    }
  }

  componentDidMount() {
    this.refreshDSPConfigFileName().catch((error) => {
      console.log("Failed to fetch DSP config filename", error)
    })
  }

  componentWillUnmount() {
    this.statusPoller.stop()
    this.levelsEventStream.stop()
  }

  private updateLevels(event: LevelsEvent) {
    this.setState((prevState) => {
      const cdspStatus = {
        ...prevState.cdspStatus,
        capturesignalrms: event.capturesignalrms,
        capturesignalpeak: event.capturesignalpeak,
        playbacksignalrms: event.playbacksignalrms,
        playbacksignalpeak: event.playbacksignalpeak,
      }
      return { cdspStatus }
    })
  }

  componentDidUpdate(prevProps: SidePanelProps, prevState: Readonly<React.ComponentState>) {
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
    if (
      this.props.dashboardExpanded &&
      ((!isCdspOnline((prevState as Readonly<{ cdspStatus: StatusWithLevels }>).cdspStatus) &&
        isCdspOnline(this.state.cdspStatus)) ||
        prevProps.dashboardExpanded !== this.props.dashboardExpanded ||
        prevProps.unappliedChanges !== this.props.unappliedChanges ||
        prevProps.currentConfigFile !== this.props.currentConfigFile)
    ) {
      this.refreshDSPConfigFileName().catch((error) => {
        console.log("Failed to refresh DSP config filename", error)
      })
    }
    // TODO save
  }

  render() {
    const { dashboardExpanded } = this.props
    const meterSize = this.meterSize(dashboardExpanded)
    return (
      <section className={dashboardExpanded ? "sidepanel sidepanel-expanded" : "sidepanel"}>
        <div className="sidepanel-header">
          <div className="sidepanel-header-main">
            <img className="sidepanel-logo" src={camillalogo} alt="graph" />
            {dashboardExpanded && this.dashboardConfigSummary()}
          </div>
          {dashboardExpanded && (
            <div className="sidepanel-header-actions">
              <MdiButton
                icon={mdiHome}
                tooltip="Change to normal view"
                buttonSize="small"
                onClick={this.props.switchToNormalView}
              />
              <MdiButton
                icon={mdiImageSizeSelectSmall}
                tooltip="Change to compact view"
                buttonSize="small"
                onClick={this.props.switchToCompactView}
              />
            </div>
          )}
        </div>
        <div className={dashboardExpanded ? "sidepanel-content sidepanel-content-expanded" : "sidepanel-content"}>
          {isCdspOnline(this.state.cdspStatus) && (
            <VolumeBox
              vuMeterStatus={this.state.cdspStatus}
              setMessage={(message) => this.setState({ msg: message })}
              inputLabels={this.state.cdspStatus.labels.capture}
              outputLabels={this.state.cdspStatus.labels.playback}
              guiConfig={this.props.guiConfig}
              meterSize={meterSize}
            />
          )}
          {isCdspOnline(this.state.cdspStatus) && (
            <AuxFadersBox guiConfig={this.props.guiConfig} dashboardExpanded={dashboardExpanded} />
          )}
          {this.cdspStateBox()}
          {!dashboardExpanded && this.configBox()}
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
      </section>
    )
  }

  private meterSize(expanded: boolean): VuMeterSize {
    if (!expanded) {
      return { width: 290, channelHeight: 10 }
    }
    const width = typeof window === "undefined" ? 1100 : Math.max(290, Math.min(window.innerWidth - 80, 1100))
    return { width, channelHeight: 24 }
  }

  private dashboardConfigSummary() {
    const { cdspStatus, dspConfigFileName } = this.state
    return (
      <div className="dashboard-config-summary">
        <div className="dashboard-config-title">{cdspStatus.title || "Untitled configuration"}</div>
        <div className="dashboard-config-description">{cdspStatus.description || "No description"}</div>
        <div className="dashboard-config-filename">{dspConfigFileName || "No active config file"}</div>
      </div>
    )
  }

  private cdspStateBox() {
    const status = this.state.cdspStatus
    return (
      <Box title="CamillaDSP">
        <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
          <div className="alignRight">State:</div>
          <div>{status.cdsp_status}</div>
          <div className="alignRight">Capt. samplerate:</div>
          <div>{status.capturerate}</div>
          <div className="alignRight">Rate adjust:</div>
          <div>{status.rateadjust ? status.rateadjust.toFixed(4) : ""}</div>
          <div className="alignRight">Clipped samples:</div>
          <div>{status.clippedsamples}</div>
          <div className="alignRight">Buffer level:</div>
          <div>{status.bufferlevel}</div>
          <div className="alignRight">DSP load:</div>
          <div>{status.processingload ? status.processingload.toFixed(1) + "%" : ""} </div>
          <div className="alignRight">Resampler load:</div>
          <div>{status.resamplerload ? status.resamplerload.toFixed(1) + "%" : ""} </div>
          <div className="alignRight">Message:</div>
          <div>{this.props.message}</div>
        </div>
        <Button
          text="Show log file"
          onClick={() => this.setState({ logFileViewerOpen: true })}
          style={{ marginTop: "10px" }}
          enabled={isBackendOnline(status)}
        />
        <LogFileViewerPopup
          open={this.state.logFileViewerOpen}
          onClose={() => this.setState({ logFileViewerOpen: false })}
        />
      </Box>
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
        <div className="setting">
          <div
            data-tooltip-html="Apply config to DSP automatically<br>after each change"
            data-tooltip-id="main-tooltip"
            style={{
              display: "table-row",
              textAlign: "center",
              marginTop: "5px",
            }}
          >
            <div className="setting-label-wide">Apply automatically</div>
            <input
              className="setting-input"
              type="checkbox"
              checked={this.state.applyConfigAutomatically}
              onChange={(e) =>
                this.setState({
                  applyConfigAutomatically: e.target.checked,
                })
              }
            />
          </div>
          <div
            data-tooltip-html="Save config to file automatically<br>after each change"
            data-tooltip-id="main-tooltip"
            style={{
              display: "table-row",
              textAlign: "center",
              marginTop: "5px",
            }}
          >
            <div className="setting-label-wide">Save automatically</div>
            <input
              className="setting-input"
              type="checkbox"
              checked={this.state.saveConfigAutomatically}
              onChange={(e) =>
                this.setState({
                  saveConfigAutomatically: e.target.checked,
                })
              }
            />
          </div>
        </div>
        <div className="two-column-grid">
          <div
            data-tooltip-html={
              unsaved ? "GUI has changes that have<br>not been saved to file" : "All changes have been saved to file"
            }
            data-tooltip-id="main-tooltip"
            style={{ textAlign: "center", marginTop: "5px" }}
          >
            {unsaved ? "All saved: ⚠️" : "All saved: ✔️"}
          </div>
          <div
            data-tooltip-html={
              unapplied
                ? "GUI has changes that have<br>not been applied to the DSP"
                : "All changes have been applied to the DSP"
            }
            data-tooltip-id="main-tooltip"
            style={{ textAlign: "center", marginTop: "5px" }}
          >
            {unapplied ? "All applied: ⚠️" : "All applied: ✔️"}
          </div>
        </div>
        <Configcheckmessage config={this.props.config} setErrors={this.props.setErrors} />
      </Box>
    )
  }

  private async fetchDSPConfig() {
    const conf_req = await fetch("/api/getconfig")
    if (!conf_req.ok) {
      const errorMessage = await conf_req.text()
      throw new Error(errorMessage)
    }
    const config = await conf_req.json()
    return config
  }

  private async fetchDSPConfigFileName() {
    const response = await fetch("/api/getactiveconfigfilename")
    if (!response.ok) {
      const errorMessage = await response.text()
      throw new Error(errorMessage)
    }
    const json = await response.json()
    return (json.configFileName as string | null) ?? null
  }

  private async refreshDSPConfigFileName() {
    if (!isCdspOnline(this.state.cdspStatus)) {
      this.setState({
        dspConfigFileName: null,
      })
      return
    }
    this.setState({
      dspConfigFileName: await this.fetchDSPConfigFileName(),
    })
  }

  private async stopProcessing() {
    const stop_req = await fetch("/api/stop", { method: "POST" })
    if (!stop_req.ok) {
      const errorMessage = await stop_req.text()
      throw new Error(errorMessage)
    }
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
