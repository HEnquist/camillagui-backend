import React, { useEffect, useState } from "react"
import "./index.css"
import { isEqual } from "lodash"
import { api, errorMessage, Schemas } from "./api/client"
import { ControllerStatus, describeFormat, describeStopReason } from "./camilladsp/status"
import { GuiConfig } from "./guiconfig"
import { ManualNotice } from "./sidepanel/manualnotice"
import { CONFIG_FILE_STATUS_ICONS, loadActiveConfigFilename, loadFiles } from "./utilities/files"
import { BoolOption, Box, Button, EnumInput, ErrorBoundary, TextOption } from "./utilities/ui-components"

type FileChecks = Schemas["ControllerFileChecks"]

const TOKENS = ["$samplerate$", "$channels$", "$format$"]

/** The controller settings as the tab edits them. The template is kept while Specific is off. */
interface Draft {
  adapt: boolean
  specific: boolean
  template: string
  errorRecovery: boolean
}

function draftOf(settings: Schemas["ControllerSettings"] | null): Draft {
  const follow = settings?.follow_capture
  return {
    adapt: follow?.adapt === true,
    specific: follow?.specific != null,
    template: follow?.specific ?? "",
    errorRecovery: settings?.error_recovery === true,
  }
}

function settingsOf(draft: Draft): Schemas["ControllerSettings"] | null {
  const following = draft.adapt || draft.specific
  if (!following && !draft.errorRecovery) return null
  return {
    follow_capture: following
      ? { adapt: draft.adapt ? true : null, specific: draft.specific ? draft.template : null }
      : null,
    error_recovery: draft.errorRecovery ? true : null,
  }
}

/** What is wrong with the draft, the same rules CamillaDSP checks. */
function draftProblem(draft: Draft): string | undefined {
  if (draft.specific && !TOKENS.some((token) => draft.template.includes(token)))
    return `The template needs at least one of ${TOKENS.join(", ")}`
  return undefined
}

/** The saved controller settings, or why there are none. */
async function fetchSettings(): Promise<Draft | string> {
  const { data, error, response } = await api.GET("/api/controller/settings")
  if (error)
    return error.result === "Invalid" ? "This CamillaDSP has no built-in controller." : errorMessage(error, response)
  return draftOf(data ?? null)
}

/** The config files that can be made active: the ones the GUI can load and are current. */
async function fetchActiveCandidates(): Promise<string[]> {
  const files = await loadFiles("config")
  return files.filter((file) => file.loadable === true && file.outdated !== true).map((file) => file.name)
}

/**
 * Everything about what CamillaDSP runs: the active config file it starts from, the built-in
 * controller that follows the source and recovers from errors, and what runs now. The config
 * editor is the other tabs.
 */
export function DspTab(props: {
  status: ControllerStatus | null
  /** Whether processing is stopped. */
  inactive: boolean
  guiConfig: GuiConfig
  openConfigFile: (name: string) => Promise<void>
}) {
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="tabpanel" style={{ width: "700px" }}>
          <ActiveConfigBox
            status={props.status}
            canUpdate={props.guiConfig.can_update_active_config}
            openConfigFile={props.openConfigFile}
          />
          <ControllerBox />
          <RunningBox status={props.status} inactive={props.inactive} openConfigFile={props.openConfigFile} />
          <FileCheckBox openConfigFile={props.openConfigFile} />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

function ActiveConfigBox(props: {
  status: ControllerStatus | null
  canUpdate: boolean
  openConfigFile: (name: string) => Promise<void>
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    loadActiveConfigFilename()
      .then((active) => setLoaded(active.config_file_name))
      .catch(() => {})
    fetchActiveCandidates().then(setCandidates)
  }, [])

  // The controller status follows changes made elsewhere, the name read at the start does not.
  const active = props.status?.entry_config_file ?? loaded
  const selected = picked ?? active
  const options: { value: string | null; label: string }[] = candidates.map((name) => ({ value: name, label: name }))
  if (selected !== null && !candidates.includes(selected)) options.unshift({ value: selected, label: selected })
  if (selected === null) options.unshift({ value: null, label: "(none)" })

  async function run() {
    if (selected === null) return
    const { error, response } = await api.POST("/api/setactiveconfigfile", { body: { name: selected } })
    if (error) {
      setMessage(errorMessage(error, response))
      return
    }
    setLoaded(selected)
    setPicked(null)
    setMessage(`${selected} is active. A running CamillaDSP has loaded it, one that is stopped starts with it.`)
  }

  return (
    <Box
      title="Active config"
      tooltip="The config file CamillaDSP starts from, kept in its statefile.<br>Following adapts it to the source, or switches to a file made for the source format."
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "5px" }}>
        {props.canUpdate ? (
          <EnumInput
            value={selected}
            options={options}
            desc="active config"
            tooltip="The config file CamillaDSP starts from"
            className="setting-input"
            style={{ flexGrow: 1 }}
            onChange={(name) => {
              setPicked(name)
              setMessage("")
            }}
          />
        ) : (
          <span
            style={{ flexGrow: 1 }}
            data-tooltip-html="The backend cannot change the active config, check its settings"
            data-tooltip-id="main-tooltip"
          >
            {active ?? "(none)"}
          </span>
        )}
        <Button
          text="Run"
          tooltip="Make this the active config, and load it in CamillaDSP.<br>A config tried from the editor but not saved is replaced."
          enabled={props.canUpdate && selected !== null}
          onClick={run}
        />
        <Button
          text="Open in editor"
          tooltip="Load this config file into the editor"
          style={{ whiteSpace: "nowrap" }}
          enabled={selected !== null}
          onClick={() => {
            if (selected !== null) props.openConfigFile(selected).catch(() => {})
          }}
        />
      </div>
      {message && <div>{message}</div>}
    </Box>
  )
}

function ControllerBox() {
  const [saved, setSaved] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState("")
  const [unavailable, setUnavailable] = useState<string | null>(null)

  function showLoaded(loaded: Draft | string) {
    if (typeof loaded === "string") {
      setUnavailable(loaded)
      return
    }
    setUnavailable(null)
    setSaved(loaded)
    setDraft(loaded)
  }

  async function loadSettings() {
    showLoaded(await fetchSettings())
  }

  useEffect(() => {
    fetchSettings().then(showLoaded)
  }, [])

  async function apply() {
    if (!draft) return
    const { error, response } = await api.POST("/api/controller/settings", {
      body: { settings: settingsOf(draft) },
    })
    if (error) {
      setMessage(errorMessage(error, response))
      return
    }
    setMessage("Applied, CamillaDSP started again from the active config")
    await loadSettings()
  }

  const title = "Following and recovery"
  const tooltip =
    "The built-in controller, set in CamillaDSP's statefile.<br>It only works when CamillaDSP runs with --wait."
  if (unavailable !== null) {
    return (
      <Box title={title} tooltip={tooltip}>
        <div>{unavailable}</div>
        <Button text="Try again" onClick={loadSettings} />
      </Box>
    )
  }
  if (draft === null) return null
  const changed = !isEqual(draft, saved)
  const problem = draftProblem(draft)
  return (
    <Box title={title} tooltip={tooltip}>
      <BoolOption
        value={draft.adapt}
        desc="adapt"
        tooltip="Follow the capture source by adapting the active config to its sample rate.<br>A config with settings that only fit its own rate is not adapted,<br>unless its samplerate list makes the source rate get resampled."
        onChange={(adapt) => setDraft({ ...draft, adapt })}
      />
      <BoolOption
        value={draft.specific}
        desc="specific"
        tooltip="Follow the capture source by switching to the config file made for its format.<br>With adapt as well, a format without its own file adapts the active config."
        onChange={(specific) => setDraft({ ...draft, specific })}
      />
      {draft.specific && (
        <TextOption
          value={draft.template}
          desc="template"
          tooltip={`File name of the config for each format, in the config folder.<br>Use the tokens ${TOKENS.join(", ")}.<br>$samplerate$ works with every source that is followed,<br>$channels$ and $format$ need a source that reports them, like the ALSA loopback.`}
          error={problem}
          onChange={(template) => setDraft({ ...draft, template })}
        />
      )}
      <BoolOption
        value={draft.errorRecovery}
        desc="error_recovery"
        tooltip="Start again after a device error, waiting 1 s at first and up to 30 s between tries."
        onChange={(errorRecovery) => setDraft({ ...draft, errorRecovery })}
      />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginTop: "5px" }}>
        <Button
          text="Apply"
          tooltip="Store the settings in CamillaDSP's statefile, and start processing again<br>from the active config file, so they apply at once.<br>A config tried from the editor but not saved is replaced."
          enabled={changed && problem === undefined}
          onClick={apply}
        />
        <Button
          text="Discard"
          tooltip="Go back to the applied settings"
          enabled={changed}
          onClick={() => {
            setDraft(saved)
            setMessage("")
          }}
        />
        {changed && <span style={{ marginLeft: "10px" }}>Not applied: ⚠️</span>}
      </div>
      {message && <div>{message}</div>}
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
  const runningVariant = status.following ? status.active_config_file : null
  const rows: [string, React.ReactNode][] = [
    ["Following", status.manual ? "paused while trying a config" : status.following ? "on" : "off"],
  ]
  rows.push([
    "Config",
    status.manual ? (
      "tried from the editor, not saved"
    ) : runningVariant ? (
      <FileLink key="running" name={runningVariant} open={props.openConfigFile} />
    ) : status.following ? (
      "the active config, adapted to the source if needed"
    ) : (
      "the active config"
    ),
  ])
  if (status.waiting_for_source) rows.push(["Waiting", `no config for ${describeFormat(status.waiting_for_source)}`])
  rows.push(["Error recovery", status.error_recovery ? "on" : "off"])
  if (status.recovering) {
    const next = status.next_retry_s != null ? `, next try in ${status.next_retry_s.toFixed(0)} s` : ""
    rows.push(["Recovering", `attempt ${status.attempts}${next}`])
  }
  rows.push(["Last stop", describeStopReason(status.stop_reason)])
  return (
    <Box title={title} tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.">
      <ManualNotice controller={status} inactive={props.inactive} />
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

  const specific = checks?.specific
  const adapt = checks?.adapt
  return (
    <Box
      title="Config check"
      tooltip="Load every config following can use, as the saved settings have them.<br>Reads every file, so it runs only when asked."
    >
      <Button text="Check the configs" onClick={check} />
      {error && <div className="error-text">{error}</div>}
      {checks && !specific && !adapt && <div>Following is off.</div>}
      {adapt && (
        <>
          <h4>Adapt, starting from the active config</h4>
          <CheckTable
            rows={[
              {
                file: adapt.file ?? "(sent by the GUI or another client)",
                samplerate: adapt.samplerates?.length ? adapt.samplerates.join(", ") : adapt.samplerate,
                channels: adapt.channels,
                format: adapt.format ?? "any",
                problem: adapt.problem,
                openable: adapt.file != null,
              },
            ]}
            rateHeader={adapt.samplerates?.length ? "Native rates" : "Rate"}
            open={props.openConfigFile}
          />
        </>
      )}
      {specific && (
        <>
          <h4>Specific files</h4>
          {specific.length === 0 ? (
            <div>No file matches the template.</div>
          ) : (
            <CheckTable
              rows={specific.map((file) => ({
                file: file.file,
                samplerate: file.samplerate,
                channels: file.channels,
                format: file.format ?? "any",
                problem: file.problem,
                openable: true,
              }))}
              rateHeader="Rate"
              open={props.openConfigFile}
            />
          )}
        </>
      )}
    </Box>
  )
}

interface CheckRow {
  file: string
  samplerate?: number | string | null
  channels?: number | null
  format: string
  problem?: string | null
  openable: boolean
}

function CheckTable(props: { rows: CheckRow[]; rateHeader: string; open: (name: string) => Promise<void> }) {
  return (
    <table style={{ width: "100%" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>File</th>
          <th>{props.rateHeader}</th>
          <th>Ch</th>
          <th>Format</th>
          <th>OK</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.file}>
            <td>{row.openable ? <FileLink name={row.file} open={props.open} /> : row.file}</td>
            <td style={{ textAlign: "right" }}>{row.samplerate ?? "any"}</td>
            <td style={{ textAlign: "right" }}>{row.channels ?? "any"}</td>
            <td>{row.format}</td>
            <td
              data-tooltip-html={row.problem ?? "Usable"}
              data-tooltip-id="main-tooltip"
              style={{ textAlign: "center" }}
            >
              {row.problem ? CONFIG_FILE_STATUS_ICONS.errors : CONFIG_FILE_STATUS_ICONS.valid}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
