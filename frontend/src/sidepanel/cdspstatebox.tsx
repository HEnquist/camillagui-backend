import * as React from "react"
import { mdiLifebuoy, mdiSync, mdiSyncAlert, mdiSyncOff } from "@mdi/js"
import { Icon } from "@mdi/react"
import { LogFileViewerPopup } from "./logfileviewer"
import { isBackendOnline, isCdspOnline, isCdspRunning, Status } from "../camilladsp/status"
import { Button, Box } from "../utilities/ui-components"

export function CdspStateBox(props: { status: Status; message: string }) {
  const { status, message } = props
  const running = isCdspRunning(status)
  const [logFileViewerOpen, setLogFileViewerOpen] = React.useState(false)

  return (
    <Box title="CamillaDSP">
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
        <div className="alignRight">State:</div>
        <div>{status.cdsp_status}</div>
        <div className="alignRight">Controller:</div>
        <div>
          <ControllerIndicator status={status} />
        </div>
        <div className="alignRight">Capt. samplerate:</div>
        <div>{running ? status.capturerate : ""}</div>
        <div className="alignRight">Rate adjust:</div>
        <div>{running && status.rateadjust ? status.rateadjust.toFixed(4) : ""}</div>
        <div className="alignRight">Clipped samples:</div>
        <div>{running ? status.clippedsamples : ""}</div>
        <div className="alignRight">Buffer level:</div>
        <div>{running ? status.bufferlevel : ""}</div>
        <div className="alignRight">DSP load:</div>
        <div>{running && status.processingload ? status.processingload.toFixed(1) + "%" : ""} </div>
        <div className="alignRight">Resampler load:</div>
        <div>{running && status.resamplerload ? status.resamplerload.toFixed(1) + "%" : ""} </div>
        <div className="alignRight">Message:</div>
        <div>{message}</div>
      </div>
      <Button
        text="Show log file"
        onClick={() => setLogFileViewerOpen(true)}
        style={{ marginTop: "10px" }}
        enabled={isBackendOnline(status)}
      />
      <LogFileViewerPopup open={logFileViewerOpen} onClose={() => setLogFileViewerOpen(false)} />
    </Box>
  )
}

const ON_COLOR = "var(--success-text-color)"
const WARNING_COLOR = "var(--warning-text-color)"
const OFF_COLOR = "var(--disabled-text-color)"

/**
 * Whether the built-in controller follows the source and recovers from errors, green when on,
 * yellow while waiting for a source or retrying, grey when off.
 */
function ControllerIndicator(props: { status: Status }) {
  const { status } = props
  if (!isCdspOnline(status)) return null
  const controller = status.controller
  if (!controller) {
    return (
      <span
        style={{ color: OFF_COLOR }}
        data-tooltip-html="This CamillaDSP has no built-in controller"
        data-tooltip-id="main-tooltip"
      >
        none
      </span>
    )
  }
  let follow = { icon: mdiSyncOff, color: OFF_COLOR, tooltip: "Not following the capture source" }
  if (controller.following && controller.waiting_for_source) {
    follow = {
      icon: mdiSyncAlert,
      color: WARNING_COLOR,
      tooltip: "Following the capture source, waiting for a format it has a config for",
    }
  } else if (controller.following) {
    follow = { icon: mdiSync, color: ON_COLOR, tooltip: "Following the capture source" }
  }
  let recovery = { color: OFF_COLOR, tooltip: "Error recovery is off", text: "recover" }
  if (controller.recovering) {
    recovery = {
      color: WARNING_COLOR,
      tooltip: "Recovering from a device error",
      text: `retry ${controller.attempts}`,
    }
  } else if (controller.error_recovery) {
    recovery = { color: ON_COLOR, tooltip: "Error recovery is on", text: "recover" }
  }
  return (
    <span style={{ display: "inline-flex", gap: "10px", alignItems: "center" }}>
      <span
        style={{ color: follow.color, display: "inline-flex", alignItems: "center", gap: "2px" }}
        data-tooltip-html={follow.tooltip}
        data-tooltip-id="main-tooltip"
      >
        <Icon path={follow.icon} size="16px" />
        follow
      </span>
      <span
        style={{ color: recovery.color, display: "inline-flex", alignItems: "center", gap: "2px" }}
        data-tooltip-html={recovery.tooltip}
        data-tooltip-id="main-tooltip"
      >
        <Icon path={mdiLifebuoy} size="16px" />
        {recovery.text}
      </span>
    </span>
  )
}
