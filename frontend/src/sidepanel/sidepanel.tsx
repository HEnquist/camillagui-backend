import React from "react"
import "../index.css"
import isEqual from "lodash/isEqual"
import { AuxFadersBox } from "./auxfaderbox"
import { CdspStateBox } from "./cdspstatebox"
import { ControllerBox } from "./controllerbox"
import { VolumeBox } from "./volumebox"
import {
  ControllerSettings,
  ControllerStatus,
  defaultStatus,
  isCdspOnline,
  isCdspRunning,
  StartupArgs,
  Status,
  StatusPoller,
} from "../camilladsp/status"
import { VersionLabels } from "../camilladsp/versions"
import { GuiConfig } from "../guiconfig"

interface SidePanelProps {
  guiConfig: GuiConfig
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
}

/**
 * The volume, then CamillaDSP, its controller and what it runs. The same in both areas. What goes
 * between the editor and CamillaDSP, applying, loading and comparing, is in the Edit area's
 * toolbar.
 */
export class SidePanel extends React.Component<SidePanelProps, { cdspStatus: Status; msg: string }> {
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

  constructor(props: SidePanelProps) {
    super(props)
    this.state = {
      cdspStatus: defaultStatus(),
      msg: "",
    }
  }

  componentWillUnmount() {
    this.statusPoller.stop()
  }

  componentDidUpdate(prevProps: SidePanelProps) {
    const { status_update_interval } = this.props.guiConfig
    if (status_update_interval !== prevProps.guiConfig.status_update_interval)
      this.statusPoller.setInterval(status_update_interval)
  }

  render() {
    return (
      <section className="sidepanel">
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
          <CdspStateBox status={this.state.cdspStatus} />
          <ControllerBox status={this.state.cdspStatus} />
          <VersionLabels versions={this.state.cdspStatus} />
        </div>
      </section>
    )
  }
}
