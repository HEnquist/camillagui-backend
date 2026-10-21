import React, { useEffect, useState } from "react"
import "./index.css"
import { isEqual } from "lodash"
import { api, errorMessage, Schemas } from "./api/client"
import { ControllerStatus } from "./camilladsp/status"
import { GuiConfig } from "./guiconfig"
import { CONFIG_FILE_STATUS_ICONS, loadActiveConfigFilename, loadFiles } from "./utilities/files"
import { BoolOption, Box, Button, EnumOption, ErrorBoundary, OptionLine, TextOption } from "./utilities/ui-components"

type SourceFormat = Schemas["SourceFormat"]
type StopReason = Schemas["StopReason"]
type FileChecks = Schemas["ControllerFileChecks"]

const TOKENS = ["$samplerate$", "$channels$", "$format$"]

/**
 * The settings as the tab edits them. The template is kept while Specific is off. `entry` is the
 * active config file, which Adapt starts from.
 */
interface Draft {
  adapt: boolean
  specific: boolean
  template: string
  errorRecovery: boolean
  entry: string | null
}

function draftOf(settings: Schemas["ControllerSettings"] | null, entry: string | null): Draft {
  const follow = settings?.follow_capture
  return {
    adapt: follow?.adapt === true,
    specific: follow?.specific != null,
    template: follow?.specific ?? "",
    errorRecovery: settings?.error_recovery === true,
    entry,
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

/** The saved settings with the active config file, or why there are none. */
async function fetchSettings(): Promise<Draft | string> {
  const { data, error, response } = await api.GET("/api/controller/settings")
  if (error)
    return error.result === "Invalid" ? "This CamillaDSP has no built-in controller." : errorMessage(error, response)
  const active = await loadActiveConfigFilename().catch(() => null)
  return draftOf(data ?? null, active?.config_file_name ?? null)
}

/** The config files Adapt can start from: the ones the GUI can load and are current. */
async function fetchEntryCandidates(): Promise<string[]> {
  const files = await loadFiles("config")
  return files.filter((file) => file.loadable === true && file.outdated !== true).map((file) => file.name)
}

export function ControllerTab(props: {
  status: ControllerStatus | null
  guiConfig: GuiConfig
  openConfigFile: (name: string) => Promise<void>
}) {
  const [saved, setSaved] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState("")
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [entryCandidates, setEntryCandidates] = useState<string[]>([])

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
    fetchEntryCandidates().then(setEntryCandidates)
  }, [])

  async function apply() {
    if (!draft) return
    // The active config first, so that the reload after the settings starts from it.
    if (draft.entry !== null && draft.entry !== saved?.entry) {
      const { error, response } = await api.POST("/api/setactiveconfigfile", { body: { name: draft.entry } })
      if (error) {
        setMessage(errorMessage(error, response))
        return
      }
    }
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

  function discard() {
    setDraft(saved)
    setMessage("")
  }

  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="tabpanel" style={{ width: "700px" }}>
          {unavailable !== null ? (
            <Box title="Controller">
              <div>{unavailable}</div>
              <Button text="Try again" onClick={loadSettings} />
            </Box>
          ) : draft !== null ? (
            <>
              <SettingsBox
                draft={draft}
                changed={!isEqual(draft, saved)}
                message={message}
                onChange={setDraft}
                apply={apply}
                discard={discard}
                entryCandidates={entryCandidates}
                savedEntry={saved?.entry ?? null}
                canUpdateEntry={props.guiConfig.can_update_active_config}
              />
              <StatusBox status={props.status} openConfigFile={props.openConfigFile} />
              <FileCheckBox openConfigFile={props.openConfigFile} />
            </>
          ) : null}
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

function SettingsBox(props: {
  draft: Draft
  changed: boolean
  message: string
  onChange: (draft: Draft) => void
  apply: () => Promise<void>
  discard: () => void
  entryCandidates: string[]
  savedEntry: string | null
  canUpdateEntry: boolean
}) {
  const { draft, onChange, changed } = props
  const problem = draftProblem(draft)
  const entryOptions: { value: string | null; label: string }[] = props.entryCandidates.map((name) => ({
    value: name,
    label: name,
  }))
  if (draft.entry !== null && !props.entryCandidates.includes(draft.entry))
    entryOptions.unshift({ value: draft.entry, label: draft.entry })
  if (draft.entry === null) entryOptions.unshift({ value: null, label: "(no active config)" })
  return (
    <Box
      title="Settings"
      tooltip="The controller section of CamillaDSP's statefile.<br>Following and error recovery only work when CamillaDSP runs with --wait."
    >
      <BoolOption
        value={draft.adapt}
        desc="adapt"
        tooltip="Follow the capture source by adapting the active config to its sample rate.<br>A config with settings that only fit its own rate is not adapted,<br>unless its samplerate list makes the source rate get resampled."
        onChange={(adapt) =>
          // A file picked to adapt from is dropped with Adapt.
          onChange({ ...draft, adapt, entry: adapt ? draft.entry : props.savedEntry })
        }
      />
      {draft.adapt &&
        (props.canUpdateEntry ? (
          <EnumOption
            value={draft.entry}
            options={entryOptions}
            desc="adapt from"
            tooltip="The config file Adapt starts from.<br>This is the active config, the one marked with a star in the Files tab,<br>so picking another file here makes that one active."
            onChange={(entry) => onChange({ ...draft, entry })}
          />
        ) : (
          <OptionLine
            desc="adapt from"
            tooltip="The config file Adapt starts from, the active config.<br>The backend cannot change the active config, check its settings."
          >
            <span className="setting-input">{draft.entry ?? "(no active config)"}</span>
          </OptionLine>
        ))}
      <BoolOption
        value={draft.specific}
        desc="specific"
        tooltip="Follow the capture source by switching to the config file made for its format.<br>With adapt as well, a format without its own file adapts the active config."
        onChange={(specific) => onChange({ ...draft, specific })}
      />
      {draft.specific && (
        <TextOption
          value={draft.template}
          desc="template"
          tooltip={`File name of the config for each format, in the config folder.<br>Use the tokens ${TOKENS.join(", ")}.<br>$samplerate$ works with every source that is followed,<br>$channels$ and $format$ need a source that reports them, like the ALSA loopback.`}
          error={problem}
          onChange={(template) => onChange({ ...draft, template })}
        />
      )}
      <BoolOption
        value={draft.errorRecovery}
        desc="error_recovery"
        tooltip="Start again after a device error, waiting 1 s at first and up to 30 s between tries."
        onChange={(errorRecovery) => onChange({ ...draft, errorRecovery })}
      />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginTop: "5px" }}>
        <Button
          text="Apply"
          tooltip="Store the settings in CamillaDSP's statefile, and start processing again<br>from the active config file, so they apply at once.<br>Changes applied to CamillaDSP but not saved to a file are lost."
          enabled={changed && problem === undefined}
          onClick={props.apply}
        />
        <Button text="Discard" tooltip="Go back to the applied settings" enabled={changed} onClick={props.discard} />
        {changed && <span style={{ marginLeft: "10px" }}>Not applied: ⚠️</span>}
      </div>
      {props.message && <div>{props.message}</div>}
    </Box>
  )
}

function StatusBox(props: { status: ControllerStatus | null; openConfigFile: (name: string) => Promise<void> }) {
  const status = props.status
  if (!status) {
    return (
      <Box title="Status">
        <div>No status from CamillaDSP.</div>
      </Box>
    )
  }
  const runningVariant = status.following ? status.active_config_file : null
  const rows: [string, React.ReactNode][] = [
    ["Following", status.following ? "on" : "off"],
    ["Active config", <FileLink key="active" name={status.entry_config_file} open={props.openConfigFile} />],
  ]
  if (status.following) {
    rows.push([
      "Running",
      runningVariant ? (
        <FileLink key="running" name={runningVariant} open={props.openConfigFile} />
      ) : (
        "the active config, adapted to the source if needed"
      ),
    ])
  }
  if (status.waiting_for_source) rows.push(["Waiting", `no config for ${describeFormat(status.waiting_for_source)}`])
  rows.push(["Error recovery", status.error_recovery ? "on" : "off"])
  if (status.recovering) {
    const next = status.next_retry_s != null ? `, next try in ${status.next_retry_s.toFixed(0)} s` : ""
    rows.push(["Recovering", `attempt ${status.attempts}${next}`])
  }
  rows.push(["Last stop", describeStopReason(status.stop_reason)])
  return (
    <Box
      title="Status"
      tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait."
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
      data-tooltip-html="Open in the editor. Save it and restart to apply the changes."
      data-tooltip-id="main-tooltip"
      onClick={() => {
        props.open(name).catch(() => {})
      }}
    >
      {name}
    </button>
  )
}

function describeFormat(format: SourceFormat): string {
  const parts = [
    format.samplerate != null ? `${format.samplerate} Hz` : null,
    format.channels != null ? `${format.channels} channels` : null,
    format.format,
  ].filter((part) => part != null)
  return parts.length > 0 ? parts.join(", ") : "an unknown format"
}

export function describeStopReason(reason: StopReason): string {
  if (reason === "None") return "none"
  if (reason === "Done") return "the capture ended"
  if ("CaptureError" in reason) return `capture error: ${reason.CaptureError}`
  if ("PlaybackError" in reason) return `playback error: ${reason.PlaybackError}`
  if ("UnknownError" in reason) return `error: ${reason.UnknownError}`
  if ("CaptureFormatChange" in reason)
    return `the capture format changed to ${describeFormat(reason.CaptureFormatChange)}`
  return `the playback format changed to ${describeFormat(reason.PlaybackFormatChange)}`
}
