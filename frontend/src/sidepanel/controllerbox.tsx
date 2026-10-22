import * as React from "react"
import { useState } from "react"
import { mdiFileSearch, mdiLifebuoy, mdiSync, mdiSyncAlert, mdiSyncOff } from "@mdi/js"
import { Icon } from "@mdi/react"
import { api, errorMessage } from "../api/client"
import { describeFormat, followsCapture, isCdspOnline, isFileless, Status } from "../camilladsp/status"
import { FileInfo, loadFiles } from "../utilities/files"
import { Box, FileSelectPopup, MdiButton, SuccessFailureButton } from "../utilities/ui-components"

const ON_COLOR = "var(--success-text-color)"
const WARNING_COLOR = "var(--warning-text-color)"
const OFF_COLOR = "var(--disabled-text-color)"

const PROVIDER_NAMES = { Single: "as written", Adapt: "adapted" }

/**
 * CamillaDSP's built-in controller: where the config comes from, the file that runs, following
 * and recovery, and below them the children, which choose what runs. Nothing while CamillaDSP is
 * offline. Without a controller only the children.
 */
export function ControllerBox(props: { status: Status; children?: React.ReactNode }) {
  const { status } = props
  const controller = status.controller
  if (!isCdspOnline(status)) return null
  if (!controller) {
    if (!props.children) return null
    return (
      <Box title="Controller">
        <div style={{ color: OFF_COLOR }}>This CamillaDSP has no built-in controller.</div>
        {props.children}
      </Box>
    )
  }
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
  const source = fileless
    ? "file-less"
    : controller.provider
      ? `files, ${PROVIDER_NAMES[controller.provider]}`
      : "files"

  return (
    <Box
      title="Controller"
      tooltip="Following and error recovery are on only when enabled and CamillaDSP runs with --wait.<br>Error recovery is set in the CamillaDSP tab."
    >
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto" }}>
        <div className="alignRight">Source:</div>
        <div
          style={fileless ? { color: WARNING_COLOR } : undefined}
          data-tooltip-html={
            fileless
              ? "CamillaDSP runs a config applied from the editor, which belongs to no file"
              : "CamillaDSP runs the active config file, as written or adapted to the capture source"
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
      {props.children}
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

/**
 * A value picked in the side panel, with the stored value it was picked against. It counts only
 * while the stored value is still that one, so it drops away once CamillaDSP has it after Run
 * from files, and gives way to a change made elsewhere.
 */
interface Staged<T> {
  value: T
  base: T
}

function stagedOr<T>(staged: Staged<T> | null, current: T): T {
  return staged !== null && staged.base === current ? staged.value : current
}

/**
 * Choosing what CamillaDSP runs: the editor's config file-less with Apply to DSP, or files with
 * Run from files. The file and the way to follow are only staged until Run from files.
 */
export function ControllerControls(props: {
  status: Status
  /** Whether the backend may change the active config file. */
  canChooseFile: boolean
  applyConfig: () => Promise<void>
  applyAutomatically: boolean
  setApplyAutomatically: (on: boolean) => void
  /** Whether CamillaDSP does not run the editor's config as it is now. */
  unappliedChanges: boolean
}) {
  const { status, unappliedChanges } = props
  const controller = status.controller
  const fileless = isFileless(controller)
  const [file, setFile] = useState<Staged<string | null> | null>(null)
  const [follow, setFollow] = useState<Staged<boolean> | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [popupOpen, setPopupOpen] = useState(false)
  const [message, setMessage] = useState("")

  const currentFile = controller?.entry_config_file ?? null
  const currentFollow = followsCapture(status.controller_settings)
  const stagedFile = stagedOr(file, currentFile)
  const stagedFollow = controller ? stagedOr(follow, currentFollow) : false
  const followChanged = stagedFollow !== currentFollow
  const changed = stagedFile !== currentFile || followChanged

  async function openPicker() {
    const all = await loadFiles("config")
    setFiles(all.filter((info) => info.loadable === true && info.outdated !== true))
    setPopupOpen(true)
  }

  async function runFromFiles() {
    if (stagedFile === null) return
    const { error, response } = await api.POST("/api/runfromfiles", {
      body: {
        file: stagedFile,
        follow: controller && followChanged ? stagedFollow : null,
      },
    })
    if (error) {
      const message = errorMessage(error, response)
      setMessage(message)
      throw new Error(message)
    }
    setMessage("")
  }

  function marker(name: string): string {
    return name === currentFile ? "★" : ""
  }

  // Without a controller, Apply to DSP runs the config like any other, and applying it after
  // each change is fine. With one, it would leave files at the first edit.
  const autoApplies = props.applyAutomatically && (fileless || !controller)
  return (
    <>
      <div className="two-column-grid" style={{ gridTemplateColumns: "max-content auto", marginTop: "10px" }}>
        <div className="alignRight">File:</div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ overflowWrap: "anywhere", flexGrow: 1 }}>{stagedFile ?? "(none)"}</span>
          <MdiButton
            icon={mdiFileSearch}
            buttonSize="small"
            tooltip={
              props.canChooseFile
                ? "Pick the config file to run from, the active config"
                : "The backend cannot change the active config, check its settings"
            }
            enabled={props.canChooseFile}
            onClick={() => {
              openPicker().catch(() => {})
            }}
          />
        </div>
        {controller && (
          <>
            <div className="alignRight">Follow:</div>
            <label
              data-tooltip-html="Follow the capture source when running from files, adapting the file to its format.<br>A source at samplerate or one of the alternate_samplerates runs natively,<br>any other rate is resampled to samplerate."
              data-tooltip-id="main-tooltip"
            >
              <input
                type="checkbox"
                checked={stagedFollow}
                onChange={(e) => setFollow({ value: e.target.checked, base: currentFollow })}
              />
              the capture source
            </label>
          </>
        )}
      </div>
      <div className="two-column-grid" style={{ marginTop: "5px" }}>
        <SuccessFailureButton
          enabled={isCdspOnline(status) && !autoApplies}
          text="Apply to DSP"
          tooltip={
            controller
              ? "Run the editor's config in CamillaDSP as it is, without a file.<br>Following stops until Run from files."
              : "Run the editor's config in CamillaDSP as it is, without saving it to a file."
          }
          onClick={props.applyConfig}
        />
        <SuccessFailureButton
          enabled={stagedFile !== null}
          highlighted={changed || fileless}
          text="Run from files"
          tooltip="Make the file the active config and run it, following the source as chosen.<br>A config applied from the editor is dropped, save it to a file first to keep it."
          onClick={runFromFiles}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
        <label
          data-tooltip-html={
            controller
              ? "Apply the editor's config to CamillaDSP after each change,<br>while it runs file-less. Running from files is left alone."
              : "Apply the editor's config to CamillaDSP after each change"
          }
          data-tooltip-id="main-tooltip"
        >
          <input
            type="checkbox"
            checked={props.applyAutomatically}
            onChange={(e) => props.setApplyAutomatically(e.target.checked)}
          />
          Apply automatically
        </label>
        {changed && (
          <span
            data-tooltip-html="The file or following differs from what CamillaDSP runs,<br>Run from files to use them"
            data-tooltip-id="main-tooltip"
          >
            Not running: ⚠️
          </span>
        )}
      </div>
      {(fileless || !controller) && (
        <div
          data-tooltip-html={
            unappliedChanges
              ? "CamillaDSP does not run the editor's config as it is now"
              : "CamillaDSP runs the editor's config"
          }
          data-tooltip-id="main-tooltip"
        >
          {unappliedChanges ? "Runs the editor's config: ⚠️" : "Runs the editor's config: ✔️"}
        </div>
      )}
      {message && <div className="error-text">{message}</div>}
      <FileSelectPopup
        open={popupOpen}
        header={<span>Pick the config file to run from. ★ is the active config.</span>}
        files={files}
        marker={marker}
        onSelect={(name) => setFile({ value: name, base: currentFile })}
        onClose={() => setPopupOpen(false)}
      />
    </>
  )
}
