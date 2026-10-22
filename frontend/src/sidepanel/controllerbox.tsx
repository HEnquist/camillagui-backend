import * as React from "react"
import { mdiLifebuoy, mdiSync, mdiSyncAlert, mdiSyncOff } from "@mdi/js"
import { Icon } from "@mdi/react"
import { describeFormat, isCdspOnline, isFileless, Status } from "../camilladsp/status"
import { Box } from "../utilities/ui-components"

const ON_COLOR = "var(--success-text-color)"
const WARNING_COLOR = "var(--warning-text-color)"
const OFF_COLOR = "var(--disabled-text-color)"

const PROVIDER_NAMES = { Single: "as written", Adapt: "adapted" }

/**
 * CamillaDSP's built-in controller at a glance: where the config comes from, the file that runs,
 * following and recovery. What runs is chosen in the Controller tab. Nothing while CamillaDSP is
 * offline or has no controller.
 */
export function ControllerBox(props: { status: Status }) {
  const { status } = props
  const controller = status.controller
  if (!isCdspOnline(status) || !controller) return null
  const fileless = isFileless(controller)

  let follow = { icon: mdiSyncOff, color: OFF_COLOR, tooltip: "Not following the capture source", text: "off" }
  if (controller.following && controller.waiting_for_source) {
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
  const source = fileless ? "file-less" : controller.provider ? `file, ${PROVIDER_NAMES[controller.provider]}` : "file"

  return (
    <Box
      title="Controller"
      tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.<br>Set them in the Controller tab."
    >
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
        <div className="alignRight">Source:</div>
        <div
          style={fileless ? { color: WARNING_COLOR } : undefined}
          data-tooltip-html={
            fileless
              ? "CamillaDSP runs a config applied from the editor, which belongs to no file"
              : "CamillaDSP runs the startup config file, as written or adapted to the capture source"
          }
          data-tooltip-id="main-tooltip"
        >
          {source}
        </div>
        {controller.config_file && (
          <>
            <div className="alignRight">Running:</div>
            <div style={{ overflowWrap: "anywhere" }}>{controller.config_file}</div>
          </>
        )}
        {!fileless && (
          <>
            <div className="alignRight">Following:</div>
            <Indicator {...follow} />
          </>
        )}
        <div className="alignRight">Recovery:</div>
        <Indicator icon={mdiLifebuoy} {...recovery} />
      </div>
      {fileless && (
        <div style={{ color: WARNING_COLOR, marginTop: "5px" }}>
          ⚠ Not saved to any file. Following is off until Run from files.
        </div>
      )}
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
