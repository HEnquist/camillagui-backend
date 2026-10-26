import React from "react"
import "../index.css"
import isEqual from "lodash/isEqual"
import { AuxFadersBox } from "./auxfaderbox"
import camillalogo from "./camilladsp.svg"
import { CdspStateBox } from "./cdspstatebox"
import { ControllerBox } from "./controllerbox"
import { VolumeBox } from "./volumebox"
import { api, errorMessage } from "../api/client"
import { Config } from "../camilladsp/config"
import {
  ControllerSettings,
  ControllerStatus,
  defaultStatus,
  isCdspOnline,
  isCdspRunning,
  isFileless,
  StartupArgs,
  Status,
  StatusPoller,
} from "../camilladsp/status"
import { VersionLabels } from "../camilladsp/versions"
import { GuiConfig } from "../guiconfig"
import { DiffPopup } from "../utilities/diffpopup"
import { delayedExecutor, SuccessFailureButton } from "../utilities/ui-components"

interface SidePanelProps {
  config: Config
  guiConfig: GuiConfig
  applyConfig: () => Promise<void>
  fetchConfig: () => Promise<void>
  /**
   * Called when the controller status, its settings or the startup args change, null when there
   * are none, or processing stops or starts.
   */
  onControllerStatus: (
    status: ControllerStatus | null,
    settings: ControllerSettings | null,
    startupArgs: StartupArgs | null,
    inactive: boolean,
  ) => void
  unappliedChanges: boolean
  /**
   * Whether the Edit area is shown. The buttons between the editor and CamillaDSP are only there
   * while it is.
   */
  editing: boolean
}

/**
 * The volume, then CamillaDSP, its controller and what it runs. The editor reaches CamillaDSP only
 * by applying its config there, which is not saved anywhere and runs file-less. The panel stays
 * mounted in both areas, so its settings and the automatic apply carry on while the Control area
 * is shown. The editor's own file and saving are in the Edit area's toolbar.
 */
export class SidePanel extends React.Component<
  SidePanelProps,
  {
    cdspStatus: Status
    applyConfigAutomatically: boolean
    msg: string
    diffConfigDSP: Config
    diffConfigGUI: Config
    showDiffPopup: boolean
  }
> {
  private statusPoller = new StatusPoller((cdspStatus) => {
    // Passed on only when it changes, since it re-renders the whole GUI.
    const previous = this.state.cdspStatus
    const inactive = cdspStatus.cdsp_status === "Inactive"
    if (
      !isEqual(cdspStatus.controller, previous.controller) ||
      !isEqual(cdspStatus.controller_settings, previous.controller_settings) ||
      !isEqual(cdspStatus.startup_args, previous.startup_args) ||
      inactive !== (previous.cdsp_status === "Inactive")
    )
      this.props.onControllerStatus(
        cdspStatus.controller,
        cdspStatus.controller_settings,
        cdspStatus.startup_args,
        inactive,
      )
    this.setState({ cdspStatus })
  }, this.props.guiConfig.status_update_interval)

  private applyTimer = delayedExecutor(500)

  constructor(props: SidePanelProps) {
    super(props)
    this.state = {
      cdspStatus: defaultStatus(),
      applyConfigAutomatically: props.guiConfig.apply_config_automatically,
      msg: "",
      diffConfigDSP: {} as Config,
      diffConfigGUI: {} as Config,
      showDiffPopup: false,
    }
  }

  componentWillUnmount() {
    this.statusPoller.stop()
  }

  componentDidUpdate(prevProps: SidePanelProps) {
    const { apply_config_automatically } = this.props.guiConfig
    if (apply_config_automatically !== prevProps.guiConfig.apply_config_automatically)
      this.setState({
        applyConfigAutomatically: apply_config_automatically,
      })
    const { status_update_interval } = this.props.guiConfig
    if (status_update_interval !== prevProps.guiConfig.status_update_interval)
      this.statusPoller.setInterval(status_update_interval)
    // Applying never leaves files, only a file-less config follows the editor. Without a
    // controller there are no files to leave.
    const controller = this.state.cdspStatus.controller
    const applies = this.state.applyConfigAutomatically && (!controller || isFileless(controller))
    if (applies && !isEqual(prevProps.config, this.props.config))
      this.applyTimer(() => {
        this.props.applyConfig().catch(() => {})
      })
  }

  render() {
    return (
      <section className="sidepanel">
        <div className="sidepanel-header">
          <div className="sidepanel-header-main">
            <img className="sidepanel-logo" src={camillalogo} alt="graph" />
          </div>
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
          <CdspStateBox status={this.state.cdspStatus}>{this.dspControls()}</CdspStateBox>
          <ControllerBox status={this.state.cdspStatus} />
          <VersionLabels versions={this.state.cdspStatus} />
        </div>
        <DiffPopup
          open={this.state.showDiffPopup}
          onClose={() => this.setState({ showDiffPopup: false })}
          left_config={this.state.diffConfigDSP}
          left_name="CamillaDSP"
          right_config={this.state.diffConfigGUI}
          right_name="Editor"
        />
      </section>
    )
  }

  /**
   * Applying the editor's config to CamillaDSP, which runs it file-less, reading what CamillaDSP
   * runs into the editor, and stopping it. Running from files is in the Control area's Configs
   * tab. Outside the Edit area, only stopping.
   */
  private dspControls() {
    const status = this.state.cdspStatus
    const online = isCdspOnline(status)
    const controller = status.controller
    const fileless = isFileless(controller)
    const unapplied = this.props.unappliedChanges
    // Without a controller, Apply to DSP runs the config like any other, and applying it after
    // each change is fine. With one, it would leave files at the first edit.
    const autoApplies = this.state.applyConfigAutomatically && (fileless || !controller)
    if (!this.props.editing)
      return (
        <div className="two-column-grid" style={{ marginTop: "5px" }}>
          <SuccessFailureButton
            enabled={online}
            text="Stop processing"
            tooltip="Stop the DSP processing"
            onClick={() => this.stopProcessing()}
          />
        </div>
      )
    return (
      <>
        <div className="two-column-grid" style={{ marginTop: "5px" }}>
          <SuccessFailureButton
            enabled={online && !autoApplies}
            text="Apply to DSP"
            tooltip={
              controller
                ? "Run the editor's config in CamillaDSP as it is, without a file.<br>Following stops until Run from files, in Control, Configs."
                : "Run the editor's config in CamillaDSP as it is, without saving it to a file."
            }
            onClick={this.props.applyConfig}
          />
          <SuccessFailureButton
            enabled={online}
            text="Load into editor"
            tooltip="Load the config CamillaDSP runs into the editor, under the name of its file.<br>While it runs the startup config adapted to the source, the file itself is loaded."
            onClick={this.props.fetchConfig}
          />
          <SuccessFailureButton
            enabled={online}
            text="Compare"
            tooltip="Compare the config CamillaDSP runs with the editor's"
            onClick={() => this.compareConfig()}
          />
          <SuccessFailureButton
            enabled={online}
            text="Stop processing"
            tooltip="Stop the DSP processing"
            onClick={() => this.stopProcessing()}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "5px" }}>
          <label
            data-tooltip-html={
              controller
                ? "Apply the editor's config to CamillaDSP after each change,<br>while it runs file-less. Running from files is left alone."
                : "Apply the editor's config to CamillaDSP after each change"
            }
            data-tooltip-id="main-tooltip"
          >
            <input
              type="checkbox"
              checked={this.state.applyConfigAutomatically}
              onChange={(e) => this.setState({ applyConfigAutomatically: e.target.checked })}
            />
            Apply automatically
          </label>
          {(fileless || !controller) && (
            <span
              data-tooltip-html={
                unapplied
                  ? "CamillaDSP does not run the editor's config as it is now"
                  : "CamillaDSP runs the editor's config"
              }
              data-tooltip-id="main-tooltip"
            >
              {unapplied ? "Runs the editor's config: ⚠️" : "Runs the editor's config: ✔️"}
            </span>
          )}
        </div>
      </>
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
    const dspConfig = await this.fetchDSPConfig()
    this.setState({
      showDiffPopup: true,
      diffConfigDSP: dspConfig as Config,
      diffConfigGUI: this.props.config,
    })
  }
}
