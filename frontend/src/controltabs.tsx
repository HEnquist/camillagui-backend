import React, { useEffect, useState } from "react"
import "./index.css"
import { api, errorMessage, Schemas } from "./api/client"
import {
  afterRestart,
  ControllerSettings,
  ControllerStatus,
  describeFormat,
  describeStopReason,
  followsCapture,
  isFileless,
  StartupArgs,
  StartupValue,
  isBackendOnline,
  isCdspOnline,
  isCdspRunning,
  stoppingFormat,
} from "./camilladsp/status"
import { useCdspStatus } from "./camilladsp/usevumeterstatus"
import { GuiConfig } from "./guiconfig"
import { LogFileViewerPopup } from "./sidepanel/logfileviewer"
import { SpectrumBox } from "./spectrumbox"
import { CONFIG_FILE_STATUS_ICONS, FileInfo, loadFiles } from "./utilities/files"
import { BoolOption, Box, Button, ErrorBoundary, SuccessFailureButton } from "./utilities/ui-components"

type FileChecks = Schemas["ControllerFileChecks"]

const PROVIDER_DESCRIPTIONS = {
  Single: "the startup config as written",
  Adapt: "the startup config adapted to the source",
}

/** What the tabs of the Control area know about CamillaDSP's built-in controller. */
interface ControllerProps {
  status: ControllerStatus | null
  settings: ControllerSettings | null
  /** Null for a CamillaDSP too old to tell. */
  startupArgs: StartupArgs | null
  openConfigFile: (name: string) => Promise<void>
}

/** The width of a Control tab, as in .control-tabpanel, less on a narrow screen. */
function controlPanelWidth(): number {
  return typeof window === "undefined" ? 700 : Math.max(290, Math.min(window.innerWidth - 30, 700))
}

/**
 * What CamillaDSP does: what runs now and after a restart, the spectrum, and its log file. The
 * landing tab of the Control area.
 */
export function OverviewTab(
  props: ControllerProps & {
    guiConfig: GuiConfig
    /** Whether processing is stopped. */
    inactive: boolean
  },
) {
  const cdspStatus = useCdspStatus(props.guiConfig)
  const [logFileViewerOpen, setLogFileViewerOpen] = useState(false)
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="tabpanel control-tabpanel">
          <RunningBox status={props.status} inactive={props.inactive} openConfigFile={props.openConfigFile} />
          <AfterRestartBox
            status={props.status}
            settings={props.settings}
            startupArgs={props.startupArgs}
            openConfigFile={props.openConfigFile}
          />
          {isCdspOnline(cdspStatus) && (
            <SpectrumBox
              guiConfig={props.guiConfig}
              labels={cdspStatus.labels}
              width={controlPanelWidth() - 20}
              isRunning={isCdspRunning(cdspStatus)}
            />
          )}
          <Box title="Log">
            <Button
              text="Show log file"
              tooltip="Show the CamillaDSP log file that the GUI is set up to read"
              onClick={() => setLogFileViewerOpen(true)}
              enabled={isBackendOnline(cdspStatus)}
            />
          </Box>
          <LogFileViewerPopup open={logFileViewerOpen} onClose={() => setLogFileViewerOpen(false)} />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

/**
 * Which config CamillaDSP runs: the config files and following, error recovery, and the check of
 * the startup config.
 */
export function ConfigsTab(
  props: ControllerProps & {
    /** Whether the backend may change the startup config file. */
    canChooseFile: boolean
    /** The editor's file, the best guess of the startup config without a controller. */
    currentConfigName?: string
    runConfigFile: (name: string) => Promise<void>
  },
) {
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="tabpanel control-tabpanel">
          <ConfigFilesBox
            status={props.status}
            settings={props.settings}
            startupArgs={props.startupArgs}
            canChooseFile={props.canChooseFile}
            currentConfigName={props.currentConfigName}
            runConfigFile={props.runConfigFile}
          />
          <RecoveryBox status={props.status} settings={props.settings} startupArgs={props.startupArgs} />
          <FileCheckBox openConfigFile={props.openConfigFile} />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

/**
 * The config files, one click each to run from files, which makes it the startup config, and
 * whether to follow the capture device. Both apply at once. The file runs as before, following
 * or not, and is loaded into the editor so that the shortcuts work on what runs. While a config
 * applied from the editor runs file-less, a click on a file, or on the startup config's button,
 * goes back to files. Without a controller, only the files.
 */
function ConfigFilesBox(props: {
  status: ControllerStatus | null
  settings: ControllerSettings | null
  startupArgs: StartupArgs | null
  canChooseFile: boolean
  currentConfigName?: string
  runConfigFile: (name: string) => Promise<void>
}) {
  const controller = props.status
  const args = props.startupArgs
  const [files, setFiles] = useState<FileInfo[]>([])
  const [message, setMessage] = useState("")
  // A change shows in the settings at the next status poll, until then the value set counts.
  const [pendingFollow, setPendingFollow] = useState<{ value: boolean; base: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadFiles("config")
      .then((all) => {
        if (!cancelled) setFiles(all.filter((info) => info.loadable === true && info.outdated !== true))
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [])

  const fileless = isFileless(controller)
  const startup = controller ? controller.startup_config_file : (props.currentConfigName ?? null)
  // The file that runs from files, as written or adapted.
  const running = controller && !fileless ? controller.config_file : null
  const storedFollow = followsCapture(props.settings)
  const follow = pendingFollow !== null && pendingFollow.base === storedFollow ? pendingFollow.value : storedFollow

  async function run(name: string) {
    try {
      await props.runConfigFile(name)
      setMessage("")
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setMessage(reason)
      throw error
    }
  }

  /** Running from files, following changes at once, with a reload. File-less, it is only stored. */
  async function setFollow(on: boolean) {
    setPendingFollow({ value: on, base: storedFollow })
    const result =
      !fileless && startup
        ? await api.POST("/api/runfromfiles", { body: { file: startup, follow: on } })
        : await api.POST("/api/controller/settings", {
            body: {
              settings:
                on || props.settings?.error_recovery != null
                  ? { follow_capture: on ? true : null, error_recovery: props.settings?.error_recovery ?? null }
                  : null,
            },
          })
    if (result.error) {
      setPendingFollow(null)
      setMessage(errorMessage(result.error, result.response))
    } else {
      setMessage("")
    }
  }

  return (
    <Box
      title="Config files"
      tooltip="Click a config file to run it from files. It becomes the startup config, the file<br>CamillaDSP loads when it starts or reloads, and is loaded into the editor.<br>★ is the startup config, the highlighted file is the one that runs."
    >
      {fileless && (
        <div style={{ marginBottom: "5px" }}>
          CamillaDSP runs a config applied from the editor, which is not saved to any file. Click a file to go back to
          running from files.
        </div>
      )}
      <div className="quick-config-switch">
        {files.map((info) => (
          <SuccessFailureButton
            key={info.name}
            text={info.name === startup ? `★ ${info.name}` : info.name}
            highlighted={info.name === running}
            enabled={props.canChooseFile}
            tooltip={
              props.canChooseFile
                ? `Run ${info.name} from files, and make it the startup config`
                : "The backend cannot change the startup config, check its settings"
            }
            onClick={() => run(info.name)}
          />
        ))}
      </div>
      {files.length === 0 && !message && <div>No config files that CamillaDSP can load.</div>}
      {args?.config_file != null && (
        <LastsUntilRestart>The command line gives {args.config_file}, a restart goes back to it.</LastsUntilRestart>
      )}
      {args?.no_config && args.config_file == null && (
        <LastsUntilRestart>The command line gives --no_config, a restart starts without a config.</LastsUntilRestart>
      )}
      {controller && (
        <label
          style={{ display: "block", marginTop: "5px" }}
          data-tooltip-html="Follow the capture device when running from files, adapting the file to its format.<br>A source at samplerate or one of the alternate_samplerates runs natively,<br>any other rate is resampled to samplerate.<br>Applies at once while running from files, with a reload."
          data-tooltip-id="main-tooltip"
        >
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked).catch(() => {})
            }}
          />
          Follow the capture device
          {fileless && <span style={{ opacity: 0.75 }}> (when running from files)</span>}
        </label>
      )}
      {controller && args?.follow_capture && (
        <LastsUntilRestart>
          The command line gives --follow_capture, so following is on again after a restart.
        </LastsUntilRestart>
      )}
      {message && <div className="error-text">{message}</div>}
    </Box>
  )
}

/** Error recovery, which applies at once, whether CamillaDSP runs from files or file-less. */
function RecoveryBox(props: {
  status: ControllerStatus | null
  settings: ControllerSettings | null
  startupArgs: StartupArgs | null
}) {
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
      {props.startupArgs?.error_recovery && (
        <LastsUntilRestart>
          The command line gives --error_recovery, so error recovery is on again after a restart.
        </LastsUntilRestart>
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
    rows.push(["Source", "file"])
    rows.push(["Provider", status.provider ? PROVIDER_DESCRIPTIONS[status.provider] : "none, nothing runs"])
    rows.push(["Running from", <FileLink key="running" name={status.config_file} open={props.openConfigFile} />])
    rows.push(["Following", status.following ? "on" : "off"])
  }
  // The startup config is the file that runs, unless it was changed without a reload since, or
  // the config runs file-less.
  if (fileless || status.startup_config_file !== status.config_file) {
    const active = <FileLink key="active" name={status.startup_config_file} open={props.openConfigFile} />
    rows.push([
      "Startup config",
      fileless ? (
        <span key="active">{active}, runs again with Run from files</span>
      ) : (
        <span key="active">{active}, runs at the next reload</span>
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
    <Box title={title} tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.">
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

const ORIGIN_NOTES = {
  "command line": "set on the command line",
  statefile: "from the statefile",
  default: "no statefile",
}

/**
 * What CamillaDSP comes back to after a restart: the command line arguments it was started with,
 * and the statefile for the rest. Marks what differs from what runs now.
 */
function AfterRestartBox(props: {
  status: ControllerStatus | null
  settings: ControllerSettings | null
  startupArgs: StartupArgs | null
  openConfigFile: (name: string) => Promise<void>
}) {
  if (!props.startupArgs) return null
  const after = afterRestart(props.status, props.settings, props.startupArgs)

  function described<T>(item: StartupValue<T>, value: React.ReactNode, note?: string): React.ReactNode {
    return (
      <span>
        {value} <span style={{ opacity: 0.75 }}>({note ?? ORIGIN_NOTES[item.origin]})</span>
        {item.differs && (
          <span data-tooltip-html="Differs from what runs now" data-tooltip-id="main-tooltip">
            {" "}
            ⚠️
          </span>
        )}
      </span>
    )
  }

  const noWait = after.wait ? undefined : "CamillaDSP runs without --wait"
  const rows: [string, React.ReactNode][] = [
    [
      "Startup config",
      described(after.configFile, <FileLink name={after.configFile.value} open={props.openConfigFile} />),
    ],
    ["Following", described(after.following, after.following.value ? "on" : "off", noWait)],
    ["Error recovery", described(after.errorRecovery, after.errorRecovery.value ? "on" : "off", noWait)],
  ]
  if (after.overrides.length > 0) rows.push(["Overrides", after.overrides.join(" ")])
  if (after.faders.length > 0) rows.push(["Faders", after.faders.join("; ")])
  return (
    <Box
      title="After a restart"
      tooltip="What CamillaDSP runs when it starts again, for example after a reboot.<br>Arguments on its command line override the statefile at every start, so they can't be changed from here."
    >
      {!after.kept && (
        <div style={{ color: "var(--warning-text-color)", marginBottom: "5px" }}>
          CamillaDSP runs without a statefile, so nothing changed while it runs is kept over a restart.
        </div>
      )}
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

/** A note that a choice lasts only until CamillaDSP restarts, since its command line sets it. */
function LastsUntilRestart(props: { children: React.ReactNode }) {
  return <div style={{ color: "var(--warning-text-color)", marginTop: "3px" }}>{props.children}</div>
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
      tooltip="Load the startup config that following adapts, the way CamillaDSP does,<br>whether following is on or not. Reads its coefficient files too, so it runs only when asked."
    >
      <Button text="Check the startup config" onClick={check} />
      {error && <div className="error-text">{error}</div>}
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
                data-tooltip-html={adapt.problem ?? (adapt.warnings.length > 0 ? "Usable, with warnings" : "Usable")}
                data-tooltip-id="main-tooltip"
                style={{ textAlign: "center" }}
              >
                {adapt.problem
                  ? CONFIG_FILE_STATUS_ICONS.errors
                  : adapt.warnings.length > 0
                    ? "⚠️"
                    : CONFIG_FILE_STATUS_ICONS.valid}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {adapt && adapt.warnings.length > 0 && (
        <div style={{ color: "var(--warning-text-color)" }}>
          A source at these rates gets no config:
          <ul style={{ margin: "3px 0" }}>
            {adapt.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
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
