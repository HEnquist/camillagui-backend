import React from "react"
import "../index.css"
import { mdiScaleUnbalanced } from "@mdi/js"
import isEqual from "lodash/isEqual"
import { AuxFadersBox } from "./auxfaderbox"
import camillalogo from "./camilladsp.svg"
import { Configcheckmessage } from "./configcheckmessage"
import { LogFileViewerPopup } from "./logfileviewer"
import { VolumeBox } from "./volumebox"
import { Config } from "../camilladsp/config"
import { defaultStatus, isBackendOnline, isCdspOnline, Status, StatusPoller } from "../camilladsp/status"
import { VersionLabels } from "../camilladsp/versions"
import { GuiConfig } from "../guiconfig"
import { DiffPopup } from "../utilities/diffpopup"
import { Errors } from "../utilities/errors"
import { Box, Button, delayedExecutor, SuccessFailureButton, MdiButton } from "../utilities/ui-components"

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
    logFileViewerOpen: boolean
    diffConfigDSP: Config
    diffConfigGUI: Config
    showDiffPopup: boolean
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
      logFileViewerOpen: false,
      diffConfigDSP: {} as Config,
      diffConfigGUI: {} as Config,
      showDiffPopup: false,
    }
  }

  componentWillUnmount() {
    this.statusPoller.stop()
  }

  componentDidUpdate(prevProps: { config: Config; guiConfig: GuiConfig }) {
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
      this.statusPoller.set_interval(status_update_interval)
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
    return (
      <section className="sidepanel">
        <img src={camillalogo} alt="graph" width="100%" height="100%" />
        {isCdspOnline(this.state.cdspStatus) && (
          <VolumeBox
            vuMeterStatus={this.state.cdspStatus}
            setMessage={(message) => this.setState({ msg: message })}
            inputLabels={this.state.cdspStatus.labels.capture}
            outputLabels={this.state.cdspStatus.labels.playback}
            guiConfig={this.props.guiConfig}
          />
        )}
        {isCdspOnline(this.state.cdspStatus) && <AuxFadersBox guiConfig={this.props.guiConfig} />}
        {this.cdspStateBox()}
        {this.configBox()}
        <DiffPopup
          open={this.state.showDiffPopup}
          onClose={() => this.setState({ showDiffPopup: false })}
          left_config={this.state.diffConfigDSP}
          left_name="DSP"
          right_config={this.state.diffConfigGUI}
          right_name="GUI"
        />
        <VersionLabels versions={this.state.cdspStatus} />
      </section>
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
