import React, { useState } from "react"
import { mdiArrowULeftTop, mdiArrowURightTop } from "@mdi/js"
import { api, errorMessage } from "./api/client"
import { Config, defaultConfig } from "./camilladsp/config"
import { ControllerStatus, isFileless } from "./camilladsp/status"
import { ImportPopup, ImportPopupProps } from "./import/importpopup"
import { Configcheckmessage } from "./sidepanel/configcheckmessage"
import { Update } from "./utilities/common"
import { DiffPopup } from "./utilities/diffpopup"
import { Errors } from "./utilities/errors"
import { loadDefaultConfigJson, loadFilenames } from "./utilities/files"
import { Button, DropdownBox, MdiButton, SuccessFailureButton } from "./utilities/ui-components"

/**
 * Everything about the editor's config, above the Edit area's tabs. Its file and history: undo and
 * redo, the file and whether it is saved, Save, Revert, Save as, New and Import, and automatic
 * saving. Between it and CamillaDSP: Apply, Load, Compare and automatic applying. And the config
 * check. It is always in view while editing, whatever the screen height. Managing the files
 * themselves is the Files tab, in the Control area.
 */
export function EditorToolbar(props: {
  config: Config
  currentConfigFile?: string
  /** The controller status, null for a CamillaDSP without a controller. */
  controller: ControllerStatus | null
  unsavedChanges: boolean
  /** Whether the editor's config differs from what was last applied to CamillaDSP. */
  unappliedChanges: boolean
  message: string
  canUndo: boolean
  canRedo: boolean
  undoDiff: string
  redoDiff: string
  undo: () => void
  redo: () => void
  saveConfig: () => Promise<void>
  revertConfig: () => Promise<void>
  /** Save the editor's config to a file, which becomes the editor's file. */
  saveConfigAs: (filename: string) => Promise<void>
  setCurrentConfig: (filename: string | undefined, config: Config) => void
  updateConfig: (update: Update<Config>) => void
  setErrors: (errors: Errors) => void
  saveAutomatically: boolean
  setSaveAutomatically: (on: boolean) => void
  /** Run the editor's config in CamillaDSP, file-less. */
  applyConfig: () => Promise<void>
  /** Load what CamillaDSP runs into the editor. */
  fetchConfig: () => Promise<void>
  applyAutomatically: boolean
  setApplyAutomatically: (on: boolean) => void
}) {
  const { currentConfigFile: file, unsavedChanges: unsaved, controller } = props
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [importPopupProps, setImportPopupProps] = useState<ImportPopupProps>({})
  const [dspConfig, setDspConfig] = useState<Config | null>(null)
  const startupConfigFile = controller?.startup_config_file
  // Without a controller, Apply to DSP runs the config like any other, and applying it after each
  // change is fine. With one, it would leave files at the first edit.
  const followsEditor = !controller || isFileless(controller)
  const autoApplies = props.applyAutomatically && followsEditor

  async function compare() {
    const { data, error, response } = await api.GET("/api/getconfig")
    if (error) throw new Error(errorMessage(error, response))
    setDspConfig(data as Config)
  }

  async function saveAs() {
    const name = window.prompt("Save the editor's config as", file ?? "New config.yml")?.trim()
    if (!name) throw new Error("Not saved")
    const existing = await loadFilenames("config")
    if (existing.includes(name) && name !== file && !window.confirm(`Overwrite?\n${name}`))
      throw new Error("Not overwritten")
    await props.saveConfigAs(name)
  }

  async function newFromDefault() {
    setNewMenuOpen(false)
    try {
      props.setCurrentConfig(undefined, await loadDefaultConfigJson())
    } catch (e) {
      console.log(e)
    }
  }

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar-group">
        <MdiButton
          icon={mdiArrowULeftTop}
          tooltip={"Undo last change<br>" + props.undoDiff}
          buttonSize="small"
          onClick={props.undo}
          enabled={props.canUndo}
        />
        <MdiButton
          icon={mdiArrowURightTop}
          tooltip={"Redo last change<br>" + props.redoDiff}
          buttonSize="small"
          onClick={props.redo}
          enabled={props.canRedo}
        />
      </div>
      <div
        className="editor-toolbar-group editor-toolbar-file"
        data-tooltip-html={
          (file ? `The editor's file, ${file}` : "The editor's config has no file, use Save as") +
          (file && file === startupConfigFile ? "<br>★ It is the startup config." : "") +
          (unsaved ? "<br>It has changes not saved to the file." : "")
        }
        data-tooltip-id="main-tooltip"
      >
        {file ?? "(no file)"}
        {file && file === startupConfigFile && " ★"}
        {unsaved ? " ⚠️" : " ✔️"}
      </div>
      <div className="editor-toolbar-group">
        <SuccessFailureButton
          enabled={Boolean(file) && !props.saveAutomatically}
          text="Save"
          tooltip={file ? `Save the editor's config to ${file}` : "No file, use Save as"}
          onClick={props.saveConfig}
        />
        <SuccessFailureButton
          enabled={Boolean(file) && unsaved}
          text="Revert"
          tooltip={file ? `Drop the changes, and load ${file} again` : "No file to revert to"}
          onClick={props.revertConfig}
        />
        <SuccessFailureButton
          text="Save as…"
          tooltip="Save the editor's config under a name, which becomes the editor's file"
          onClick={saveAs}
        />
        <div className="dropdown">
          <Button
            text="New ▾"
            tooltip="Start a new config. Any unsaved changes are lost."
            highlighted={newMenuOpen}
            onClick={() => setNewMenuOpen(!newMenuOpen)}
          />
          <DropdownBox enabled={newMenuOpen} onOutsideClick={() => setNewMenuOpen(false)}>
            <div className="vertically-spaced-content">
              <Button
                text="From the default config"
                onClick={() => {
                  newFromDefault().catch(() => {})
                }}
              />
              <Button
                text="Blank"
                onClick={() => {
                  setNewMenuOpen(false)
                  props.setCurrentConfig(undefined, defaultConfig())
                }}
              />
            </div>
          </DropdownBox>
        </div>
        <Button
          text="Import"
          onClick={() =>
            setImportPopupProps({
              currentConfig: props.config,
              updateConfig: props.updateConfig,
              close: () => setImportPopupProps({}),
            })
          }
          tooltip="Import items from another config into the editor's"
        />
      </div>
      <label
        className="editor-toolbar-group"
        data-tooltip-html="Save the config to its file<br>after each change"
        data-tooltip-id="main-tooltip"
      >
        <input
          type="checkbox"
          checked={props.saveAutomatically}
          onChange={(e) => props.setSaveAutomatically(e.target.checked)}
        />
        Save automatically
      </label>
      <div className="editor-toolbar-group">
        <SuccessFailureButton
          enabled={!autoApplies}
          text="Apply to DSP"
          tooltip={
            controller
              ? "Run the editor's config in CamillaDSP as it is, without a file.<br>Following stops until a file is run, in Control, Configs."
              : "Run the editor's config in CamillaDSP as it is, without saving it to a file."
          }
          onClick={props.applyConfig}
        />
        <SuccessFailureButton
          text="Load from DSP"
          tooltip="Load the config CamillaDSP runs into the editor, under the name of its file.<br>While it runs the startup config adapted to the source, the file itself is loaded."
          onClick={props.fetchConfig}
        />
        <SuccessFailureButton
          text="Compare with DSP"
          tooltip="Compare the config CamillaDSP runs with the editor's"
          onClick={compare}
        />
      </div>
      <label
        className="editor-toolbar-group"
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
        {followsEditor && (
          <span
            data-tooltip-html={
              props.unappliedChanges
                ? "CamillaDSP does not run the editor's config as it is now"
                : "CamillaDSP runs the editor's config"
            }
            data-tooltip-id="main-tooltip"
          >
            {props.unappliedChanges ? " ⚠️" : " ✔️"}
          </span>
        )}
      </label>
      <div className="editor-toolbar-group">
        <Configcheckmessage config={props.config} setErrors={props.setErrors} />
      </div>
      {props.message && <div className="editor-toolbar-group editor-toolbar-message">{props.message}</div>}
      <ImportPopup {...importPopupProps} />
      <DiffPopup
        open={dspConfig !== null}
        onClose={() => setDspConfig(null)}
        left_config={dspConfig ?? ({} as Config)}
        left_name="CamillaDSP"
        right_config={props.config}
        right_name="Editor"
      />
    </div>
  )
}
