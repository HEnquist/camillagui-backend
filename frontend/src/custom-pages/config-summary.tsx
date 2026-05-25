import React from "react"
import type { CustomPageProps } from "./types"
import { Box } from "../utilities/ui-components"

function ConfigSummary({ config }: CustomPageProps) {
  const filterCount = Object.keys(config.filters ?? {}).length
  const mixerCount = Object.keys(config.mixers ?? {}).length
  const processorCount = Object.keys(config.processors ?? {}).length
  const capture = config.devices.capture
  const captureChannels = "channels" in capture ? capture.channels : "N/A"

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "500px" }}>
        <Box title="Devices">
          <table>
            <tbody>
              <tr><td>Samplerate</td><td>{config.devices.samplerate} Hz</td></tr>
              <tr><td>Capture</td><td>{capture.type}, {captureChannels} ch</td></tr>
              <tr><td>Playback</td><td>{config.devices.playback.type}, {config.devices.playback.channels} ch</td></tr>
            </tbody>
          </table>
        </Box>
        <Box title="Pipeline items">
          <table>
            <tbody>
              <tr><td>Filters</td><td>{filterCount}</td></tr>
              <tr><td>Mixers</td><td>{mixerCount}</td></tr>
              <tr><td>Processors</td><td>{processorCount}</td></tr>
              <tr><td>Pipeline steps</td><td>{config.pipeline?.length ?? 0}</td></tr>
            </tbody>
          </table>
        </Box>
        {config.title && (
          <Box title="Title">
            <p>{config.title}</p>
          </Box>
        )}
      </div>
      <div className="tabspacer" />
    </div>
  )
}

// Set to false to disable this tab without deleting the file.
ConfigSummary.tabLabel = "Config Summary"
ConfigSummary.enabled = false

export default ConfigSummary
