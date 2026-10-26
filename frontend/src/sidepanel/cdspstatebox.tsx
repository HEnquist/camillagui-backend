import * as React from "react"
import { api, errorMessage } from "../api/client"
import { isCdspOnline, isCdspRunning, Status } from "../camilladsp/status"
import { Box, SuccessFailureButton } from "../utilities/ui-components"

/** The state of CamillaDSP, and stopping it. Its log file is on the Control area's Overview. */
export function CdspStateBox(props: { status: Status }) {
  const { status } = props
  const running = isCdspRunning(status)

  async function stopProcessing() {
    const { error, response } = await api.POST("/api/stop")
    if (error) throw new Error(errorMessage(error, response))
  }

  return (
    <Box title="CamillaDSP">
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
        <div className="alignRight">State:</div>
        <div>{status.cdsp_status}</div>
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
      </div>
      <div className="two-column-grid" style={{ marginTop: "5px" }}>
        <SuccessFailureButton
          enabled={isCdspOnline(status)}
          text="Stop processing"
          tooltip="Stop the DSP processing"
          onClick={stopProcessing}
        />
      </div>
    </Box>
  )
}
