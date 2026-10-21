import * as React from "react"
import { mdiLifebuoy, mdiPauseCircleOutline, mdiSync, mdiSyncAlert, mdiSyncOff } from "@mdi/js"
import { Icon } from "@mdi/react"
import { ManualNotice } from "./manualnotice"
import { describeFormat, isCdspOnline, Status } from "../camilladsp/status"
import { Box } from "../utilities/ui-components"

const ON_COLOR = "var(--success-text-color)"
const WARNING_COLOR = "var(--warning-text-color)"
const OFF_COLOR = "var(--disabled-text-color)"

/**
 * CamillaDSP's built-in controller: whether it follows the source and recovers from errors, the
 * active config, the file following runs when it runs one, and the notice of a tried config.
 * Nothing while CamillaDSP is offline or has no controller.
 */
export function ControllerBox(props: { status: Status }) {
  const { status } = props
  const controller = status.controller
  if (!isCdspOnline(status) || !controller) return null
  const running = controller.following ? controller.active_config_file : null

  let follow = { icon: mdiSyncOff, color: OFF_COLOR, tooltip: "Not following the capture source", text: "off" }
  if (controller.manual) {
    follow = {
      icon: mdiPauseCircleOutline,
      color: WARNING_COLOR,
      tooltip: "Paused while a config tried from the editor runs.<br>Resume, or run a file, to follow again.",
      text: "paused",
    }
  } else if (controller.following && controller.waiting_for_source) {
    follow = {
      icon: mdiSyncAlert,
      color: WARNING_COLOR,
      tooltip: `Following the capture source, no config for ${describeFormat(controller.waiting_for_source)}`,
      text: "waiting",
    }
  } else if (controller.following) {
    follow = { icon: mdiSync, color: ON_COLOR, tooltip: "Following the capture source", text: "on" }
  }
  let recovery = { color: OFF_COLOR, tooltip: "Error recovery is off", text: "off" }
  if (controller.recovering) {
    recovery = {
      color: WARNING_COLOR,
      tooltip: "Recovering from a device error",
      text: `retry ${controller.attempts}`,
    }
  } else if (controller.error_recovery) {
    recovery = { color: ON_COLOR, tooltip: "Error recovery is on", text: "on" }
  }

  return (
    <Box
      title="Controller"
      tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.<br>Set them in the CamillaDSP tab."
    >
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
        <div className="alignRight">Following:</div>
        <Indicator {...follow} />
        <div className="alignRight">Recovery:</div>
        <Indicator icon={mdiLifebuoy} {...recovery} />
        <div className="alignRight">Active config:</div>
        <div
          style={{ overflowWrap: "anywhere" }}
          data-tooltip-html="The config file CamillaDSP starts from, set in the CamillaDSP tab"
          data-tooltip-id="main-tooltip"
        >
          {controller.entry_config_file ?? "none"}
        </div>
        {running && (
          <>
            <div className="alignRight">Running:</div>
            <div
              style={{ overflowWrap: "anywhere" }}
              data-tooltip-html="Picked by following the capture source"
              data-tooltip-id="main-tooltip"
            >
              {running}
            </div>
          </>
        )}
      </div>
      <ManualNotice controller={controller} inactive={status.cdsp_status === "Inactive"} />
    </Box>
  )
}

function Indicator(props: { icon: string; color: string; tooltip: string; text: string }) {
  return (
    <div
      style={{ color: props.color, display: "inline-flex", alignItems: "center", gap: "2px" }}
      data-tooltip-html={props.tooltip}
      data-tooltip-id="main-tooltip"
    >
      <Icon path={props.icon} size="16px" />
      {props.text}
    </div>
  )
}
