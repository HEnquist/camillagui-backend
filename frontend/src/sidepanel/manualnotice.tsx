import React, { useState } from "react"
import { mdiPauseCircleOutline } from "@mdi/js"
import { Icon } from "@mdi/react"
import { api, errorMessage } from "../api/client"
import { ControllerStatus, describeFormat, stoppingFormat } from "../camilladsp/status"
import { Button } from "../utilities/ui-components"

/**
 * Says that CamillaDSP runs a config sent from the editor, not saved in any file, while the
 * controller leaves it alone, and offers to go back to the active config. Nothing without manual
 * mode.
 */
export function ManualNotice(props: { controller: ControllerStatus | null; inactive: boolean }) {
  const { controller, inactive } = props
  const [error, setError] = useState<string | null>(null)
  if (!controller?.manual) return null
  const stoppedBy = inactive ? stoppingFormat(controller.stop_reason) : null

  async function resume() {
    const { error, response } = await api.POST("/api/reload")
    setError(error ? errorMessage(error, response) : null)
  }

  return (
    <div
      style={{
        border: "1px solid var(--warning-text-color)",
        borderRadius: "4px",
        padding: "5px",
        margin: "5px 0",
      }}
    >
      <div
        style={{
          color: "var(--warning-text-color)",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <Icon path={mdiPauseCircleOutline} size="16px" />
        Trying a config
      </div>
      <div>CamillaDSP runs a config tried from the editor. It is not saved to any file, and following is paused.</div>
      {stoppedBy && <div>Stopped, the source changed to {describeFormat(stoppedBy)}.</div>}
      <Button
        text="Resume"
        tooltip="Load the active config file again, and follow the source if following is on.<br>The tried config is dropped, save it to a file first to keep it."
        onClick={resume}
        style={{ marginTop: "5px" }}
      />
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
