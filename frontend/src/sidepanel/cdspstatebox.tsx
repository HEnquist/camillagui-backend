import * as React from "react"
import { LogFileViewerPopup } from "./logfileviewer"
import { isBackendOnline, Status } from "../camilladsp/status"
import { Button, Box } from "../utilities/ui-components"

export function CdspStateBox(props: { status: Status; message: string }) {
  const { status, message } = props
  const [logFileViewerOpen, setLogFileViewerOpen] = React.useState(false)

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
