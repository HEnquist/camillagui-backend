import React, { useState } from "react"
import { Config, defaultConfig } from "../camilladsp/config"
import { ImportPopup, ImportPopupProps } from "../import/importpopup"
import { Update } from "../utilities/common"
import { loadDefaultConfigJson, loadFilenames } from "../utilities/files"
import { Button, SuccessFailureButton } from "../utilities/ui-components"

/**
 * The editor's own file actions, in the side panel's Editor box: saving its config under a name,
 * starting a new config, and importing parts of another one. Managing the files themselves is
 * the Files tab, in the Control area.
 */
export function EditorFileActions(props: {
  currentConfigFile?: string
  config: Config
  setCurrentConfig: (filename: string | undefined, config: Config) => void
  updateConfig: (update: Update<Config>) => void
  /** Save the editor's config to a file, which becomes the editor's file. */
  saveConfigAs: (filename: string) => Promise<void>
  online: boolean
}) {
  // The side panel keys this on the editor's file, so the name starts over when it changes.
  const [name, setName] = useState(props.currentConfigFile ?? "New config.yml")
  const [importPopupProps, setImportPopupProps] = useState<ImportPopupProps>({})
  const trimmed = name.trim()

  async function saveAs() {
    const existing = await loadFilenames("config")
    if (existing.includes(trimmed) && trimmed !== props.currentConfigFile && !window.confirm(`Overwrite?\n${trimmed}`))
      throw new Error("Not overwritten")
    await props.saveConfigAs(trimmed)
  }

  async function newFromDefault() {
    try {
      props.setCurrentConfig(undefined, await loadDefaultConfigJson())
    } catch (e) {
      console.log(e)
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "5px" }}>
        <SuccessFailureButton
          enabled={props.online && trimmed.length > 0}
          text="Save as"
          tooltip="Save the editor's config to the named file, which becomes the editor's file"
          onClick={saveAs}
        />
        <input
          type="text"
          value={name}
          style={{ flex: 1, minWidth: 0 }}
          data-tooltip-html="The name to save the editor's config as"
          data-tooltip-id="main-tooltip"
          spellCheck="false"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="two-column-grid" style={{ marginTop: "5px" }}>
        <Button
          text="New from default"
          onClick={() => {
            newFromDefault().catch(() => {})
          }}
          tooltip="Start a new config from the default config.<br>Any unsaved changes are lost."
        />
        <Button
          text="New blank"
          onClick={() => props.setCurrentConfig(undefined, defaultConfig())}
          tooltip="Start a new blank config.<br>Any unsaved changes are lost."
        />
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
      <ImportPopup {...importPopupProps} />
    </>
  )
}
