import React from "react"
import { mdiAlertCircle, mdiCheck, mdiDelete, mdiDownload, mdiPencil, mdiUpload } from "@mdi/js"
import { StoredFileType } from "./files"
import { MdiButton, UploadButton } from "./ui-components"

export type FileAction = "load" | "save" | "upload" | "rename" | "play" | "open"
export const EMPTY_FILENAME = "" // used only for FileAction 'upload'
export type FileStatus =
  | {
      filename: string
      action: FileAction
      success: true
    }
  | {
      filename: string
      action: FileAction
      success: false
      statusText: string
    }

export function DownloadFilesAsZipButton(props: { selectedFiles: string[]; downloadAsZip: () => void }) {
  const { selectedFiles, downloadAsZip } = props
  const fileOrFiles = selectedFiles.length > 1 ? "files" : "file"
  return (
    <MdiButton
      icon={mdiDownload}
      tooltip={
        selectedFiles.length === 0
          ? "Download selected files<br>Select at least one file first!"
          : `Download ${selectedFiles.length} ${fileOrFiles} as zip file`
      }
      enabled={selectedFiles.length > 0}
      onClick={downloadAsZip}
    />
  )
}

export function DeleteFilesButton(props: { selectedFiles: string[]; delete: () => void }) {
  const selectedFiles = props.selectedFiles
  const fileOrFiles = selectedFiles.length > 1 ? "files" : "file"
  return (
    <MdiButton
      icon={mdiDelete}
      tooltip={
        selectedFiles.length === 0
          ? "Delete selected files<br>Select at least one file first!"
          : `Delete ${selectedFiles.length} ${fileOrFiles}`
      }
      enabled={selectedFiles.length > 0}
      onClick={props.delete}
    />
  )
}

export function UploadFilesButton(props: { fileStatus: FileStatus | null; upload: (files: FileList) => void }) {
  const fileStatus = props.fileStatus
  let uploadIcon: { icon: string; className?: string } = { icon: mdiUpload }
  if (
    fileStatus !== null &&
    fileStatus.action === "upload" &&
    fileStatus.filename === EMPTY_FILENAME &&
    !fileStatus.success
  )
    uploadIcon = { icon: mdiAlertCircle, className: "error-text" }
  return (
    <UploadButton
      icon={uploadIcon.icon}
      tooltip={"Upload files"}
      upload={props.upload}
      className={uploadIcon.className}
      multiple={true}
    />
  )
}

export function RenameButton(props: { filename: string; fileStatus: FileStatus | null; rename: () => void }) {
  const { filename, fileStatus, rename } = props
  let renameIcon: { icon: string; className?: string } = { icon: mdiPencil }
  if (fileStatus !== null && fileStatus.action === "rename" && fileStatus.filename === filename) {
    renameIcon = fileStatus.success
      ? { icon: mdiCheck, className: "success-text" }
      : { icon: mdiAlertCircle, className: "error-text" }
  }
  return (
    <MdiButton
      icon={renameIcon.icon}
      className={renameIcon.className}
      tooltip={`Rename ${filename}`}
      onClick={rename}
    />
  )
}

export function FileStatusMessage(props: { filename: string; fileStatus: FileStatus | null; type: StoredFileType }) {
  const { fileStatus, filename, type } = props
  if (fileStatus && !fileStatus.success && fileStatus.filename === filename)
    return (
      <div className={fileStatus.success ? "success-text" : "error-text"}>
        Could not {fileStatus.action} {type}:<br />
        {fileStatus.statusText}
      </div>
    )
  else return null
}
