import React, { useState } from "react"
import "./index.css"
import { api, errorMessage, Schemas } from "./api/client"
import {
  ControllerSettings,
  ControllerStatus,
  describeFormat,
  describeStopReason,
  isFileless,
  stoppingFormat,
} from "./camilladsp/status"
import { CONFIG_FILE_STATUS_ICONS } from "./utilities/files"
import { BoolOption, Box, Button, ErrorBoundary } from "./utilities/ui-components"

type FileChecks = Schemas["ControllerFileChecks"]

const PROVIDER_DESCRIPTIONS = {
  Single: "the active config as written",
  Adapt: "the active config adapted to the source",
}

/**
 * The details of CamillaDSP's built-in controller: error recovery, what runs now, and a check
 * of the config following adapts. What runs is chosen in the side panel's Controller box, the
 * config editor is the other tabs.
 */
export function DspTab(props: {
  status: ControllerStatus | null
  settings: ControllerSettings | null
  /** Whether processing is stopped. */
  inactive: boolean
  openConfigFile: (name: string) => Promise<void>
}) {
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="tabpanel" style={{ width: "700px" }}>
          <RunningBox status={props.status} inactive={props.inactive} openConfigFile={props.openConfigFile} />
          <RecoveryBox status={props.status} settings={props.settings} />
          <FileCheckBox openConfigFile={props.openConfigFile} />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

/** Error recovery, which applies at once, whether CamillaDSP runs from files or file-less. */
function RecoveryBox(props: { status: ControllerStatus | null; settings: ControllerSettings | null }) {
  const { status, settings } = props
  // A change shows in the settings at the next status poll, until then the value set counts.
  const [pending, setPending] = useState<{ value: boolean; base: boolean } | null>(null)
  const [message, setMessage] = useState("")
  const stored = settings?.error_recovery === true
  const waiting = pending !== null && pending.base === stored

  if (!status) return null

  async function set(on: boolean) {
    setPending({ value: on, base: stored })
    const next = { ...settings, error_recovery: on ? true : null }
    const empty = next.follow_capture == null && next.error_recovery == null
    const { error, response } = await api.POST("/api/controller/settings", {
      body: { settings: empty ? null : next },
    })
    if (error) {
      setPending(null)
      setMessage(errorMessage(error, response))
    } else {
      setMessage("")
    }
  }

  const on = waiting ? pending!.value : stored
  return (
    <Box
      title="Error recovery"
      tooltip="Set in CamillaDSP's statefile. It only works when CamillaDSP runs with --wait."
    >
      <BoolOption
        value={on}
        desc="error_recovery"
        tooltip="Start again after a device error, waiting 1 s at first and up to 10 s between tries.<br>Applies at once, to a config from files and a file-less one alike."
        onChange={(value) => {
          set(value).catch(() => {})
        }}
      />
      {on && !status.error_recovery && !waiting && (
        <div>CamillaDSP does not run with --wait, so error recovery is off.</div>
      )}
      {message && <div className="error-text">{message}</div>}
    </Box>
  )
}

function RunningBox(props: {
  status: ControllerStatus | null
  inactive: boolean
  openConfigFile: (name: string) => Promise<void>
}) {
  const status = props.status
  const title = "Running now"
  if (!status) {
    return (
      <Box title={title}>
        <div>No controller status from CamillaDSP.</div>
      </Box>
    )
  }
  const fileless = isFileless(status)
  const rows: [string, React.ReactNode][] = []
  if (fileless) {
    rows.push(["Source", "file-less, a config applied from the editor and not saved"])
    const stoppedBy = props.inactive ? stoppingFormat(status.stop_reason) : null
    if (stoppedBy)
      rows.push(["Stopped", `the source changed to ${describeFormat(stoppedBy)}, a file-less config is not followed`])
  } else {
    rows.push(["Source", "files"])
    rows.push(["Provider", status.provider ? PROVIDER_DESCRIPTIONS[status.provider] : "none, nothing runs"])
    rows.push(["Config", <FileLink key="running" name={status.config_file} open={props.openConfigFile} />])
    rows.push(["Following", status.following ? "on" : "off"])
  }
  rows.push(["Active config", <FileLink key="active" name={status.entry_config_file} open={props.openConfigFile} />])
  if (status.waiting_for_source) rows.push(["Waiting", `no config for ${describeFormat(status.waiting_for_source)}`])
  rows.push(["Error recovery", status.error_recovery ? "on" : "off"])
  if (status.recovering) {
    const next = status.next_retry_s != null ? `, next try in ${status.next_retry_s.toFixed(0)} s` : ""
    rows.push(["Recovering", `attempt ${status.attempts}${next}`])
  }
  rows.push(["Last stop", describeStopReason(status.stop_reason)])
  return (
    <Box
      title={title}
      tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.<br>Choose what runs in the side panel's Controller box."
    >
      <div style={{ display: "grid", gridTemplateColumns: "max-content auto", columnGap: "15px", rowGap: "3px" }}>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <span style={{ fontWeight: "bold" }}>{label}</span>
            <span>{value}</span>
          </React.Fragment>
        ))}
      </div>
    </Box>
  )
}

function FileCheckBox(props: { openConfigFile: (name: string) => Promise<void> }) {
  const [checks, setChecks] = useState<FileChecks | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    const { data, error, response } = await api.GET("/api/controller/checkfiles")
    if (data) {
      setChecks(data)
      setError(null)
    } else {
      setChecks(null)
      setError(errorMessage(error, response))
    }
  }

  const adapt = checks?.adapt
  return (
    <Box
      title="Config check"
      tooltip="Load the active config that following adapts, the way CamillaDSP does.<br>Reads its coefficient files too, so it runs only when asked."
    >
      <Button text="Check the active config" onClick={check} />
      {error && <div className="error-text">{error}</div>}
      {checks && !adapt && <div>Following is off.</div>}
      {adapt && (
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>File</th>
              <th>Rate</th>
              <th>Alternate rates</th>
              <th>Ch</th>
              <th>Format</th>
              <th>OK</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {adapt.file != null ? (
                  <FileLink name={adapt.file} open={props.openConfigFile} />
                ) : (
                  "(sent by the GUI or another client)"
                )}
              </td>
              <td style={{ textAlign: "right" }}>{adapt.samplerate ?? "any"}</td>
              <td
                style={{ textAlign: "right" }}
                data-tooltip-html="The rates that run natively besides the config's own.<br>A source at any other rate is resampled."
                data-tooltip-id="main-tooltip"
              >
                {adapt.alternate_samplerates.length > 0 ? adapt.alternate_samplerates.join(", ") : "none"}
              </td>
              <td style={{ textAlign: "right" }}>{adapt.channels ?? "any"}</td>
              <td>{adapt.format ?? "any"}</td>
              <td
                data-tooltip-html={adapt.problem ?? "Usable"}
                data-tooltip-id="main-tooltip"
                style={{ textAlign: "center" }}
              >
                {adapt.problem ? CONFIG_FILE_STATUS_ICONS.errors : CONFIG_FILE_STATUS_ICONS.valid}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Box>
  )
}

/** A config file name that opens the file in the editor, or the path when it is outside the config folder. */
function FileLink(props: { name?: string | null; open: (name: string) => Promise<void> }) {
  const name = props.name
  if (!name) return <>none</>
  if (name.includes("/") || name.includes("\\")) return <>{name}</>
  return (
    <button
      type="button"
      className="file-link"
      style={{ width: "max-content" }}
      data-tooltip-html="Open in the editor"
      data-tooltip-id="main-tooltip"
      onClick={() => {
        props.open(name).catch(() => {})
      }}
    >
      {name}
    </button>
  )
}
