import React, { useState } from "react"
import { mdiArrowULeftTop, mdiArrowURightTop } from "@mdi/js"
import { Config, defaultConfig } from "./camilladsp/config"
import { ImportPopup, ImportPopupProps } from "./import/importpopup"
import { Configcheckmessage } from "./sidepanel/configcheckmessage"
import { Update } from "./utilities/common"
import { Errors } from "./utilities/errors"
import { loadDefaultConfigJson, loadFilenames } from "./utilities/files"
import { Button, DropdownBox, MdiButton, SuccessFailureButton } from "./utilities/ui-components"

/**
 * The editor's file and history, above the Edit area's tabs: undo and redo, the file and whether
 * it is saved, Save, Revert, Save as, New and Import, automatic saving, and the config check. It
 * is always in view while editing, whatever the screen height. Managing the files themselves is
 * the Files tab, in the Control area.
 */
export function EditorToolbar(props: {
  config: Config
  currentConfigFile?: string
  /** The startup config file, marked next to the editor's file when they are the same. */
  startupConfigFile?: string | null
  unsavedChanges: boolean
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
}) {
  const { currentConfigFile: file, unsavedChanges: unsaved } = props
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [importPopupProps, setImportPopupProps] = useState<ImportPopupProps>({})

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
          (file && file === props.startupConfigFile ? "<br>★ It is the startup config." : "") +
          (unsaved ? "<br>It has changes not saved to the file." : "")
        }
        data-tooltip-id="main-tooltip"
      >
        {file ?? "(no file)"}
        {file && file === props.startupConfigFile && " ★"}
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
        <Configcheckmessage config={props.config} setErrors={props.setErrors} />
      </div>
      {props.message && <div className="editor-toolbar-group editor-toolbar-message">{props.message}</div>}
      <ImportPopup {...importPopupProps} />
    </div>
  )
}
