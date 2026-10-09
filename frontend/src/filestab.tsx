import React, { Component } from "react"
import {
  mdiAlertCircle,
  mdiCheck,
  mdiContentSave,
  mdiMenu,
  mdiOpenInApp,
  mdiRefresh,
  mdiScaleUnbalanced,
  mdiStar,
  mdiStarOutline,
} from "@mdi/js"
import { ColumnDef } from "@tanstack/react-table"
import { isEqual } from "lodash"
import { api, errorMessage } from "./api/client"
import { Config, CURRENT_CONFIG_VERSION, defaultConfig } from "./camilladsp/config"
import { clearCoefficientCache } from "./camilladsp/eval"
import { GuiConfig } from "./guiconfig"
import { ImportPopup, ImportPopupProps } from "./import/importpopup"
import { PipelinePopup } from "./pipeline/pipelineplotter"
import { Update } from "./utilities/common"
import { DataTable, sortByRows } from "./utilities/data-table"
import { DiffPopup } from "./utilities/diffpopup"
import {
  DeleteFilesButton,
  DownloadFilesAsZipButton,
  EMPTY_FILENAME,
  FileAction,
  FileStatus,
  FileStatusMessage,
  RenameButton,
  UploadFilesButton,
} from "./utilities/file-actions"
import {
  CONFIG_FILE_STATUS_ICONS,
  configFileStatus,
  deleteFiles,
  doUpload,
  downloadAsZip,
  downloadFromUrl,
  FileInfo,
  fileNamesOf,
  fileStatusDesc,
  loadActiveConfigFilename,
  loadConfigJson,
  loadDefaultConfigJson,
  loadFiles,
  loadMigratedConfigJson,
  renameFile,
  StoredFileType,
} from "./utilities/files"
import {
  Box,
  Button,
  DropdownBox,
  ErrorBoundary,
  fileDateSort,
  fileNameSort,
  fileTitleSort,
  fileValidSort,
  MdiButton,
  PlotButton,
} from "./utilities/ui-components"

export function Files(props: {
  guiConfig: GuiConfig
  currentConfigFile?: string
  config: Config
  setCurrentConfig: (filename: string | undefined, config: Config) => void
  setCurrentConfigFileName: (filename: string | undefined) => void
  updateConfig: (update: Update<Config>) => void
  saveNotify: () => void
}) {
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="wide-tabpanel" style={{ width: "900px" }}>
          <NewConfig
            currentConfig={props.config}
            setCurrentConfig={props.setCurrentConfig}
            updateConfig={props.updateConfig}
          />
          <FileTable
            title="Configs"
            type="config"
            currentConfigFile={props.currentConfigFile}
            config={props.config}
            setCurrentConfig={props.setCurrentConfig}
            setCurrentConfigFileName={props.setCurrentConfigFileName}
            saveNotify={props.saveNotify}
            canUpdateActiveConfig={props.guiConfig.can_update_active_config}
          />
          <FileTable title="Filters" type="coeff" />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

type FileType = StoredFileType

interface FileTableProps {
  title: string
  type: FileType
  currentConfigFile?: string
  config?: Config
  canUpdateActiveConfig?: boolean
  setCurrentConfig?: (filename: string, config: Config) => void
  setCurrentConfigFileName?: (filename: string | undefined) => void
  saveNotify?: () => void
}

class FileTable extends Component<
  FileTableProps,
  {
    files: FileInfo[]
    selectedFiles: FileInfo[]
    activeConfigFileName: string | null
    newFileName: string
    fileStatus: FileStatus | null
    stopTimer: () => void
    filterText: string
    showDiffPopup: boolean
    diffConfigLeft: Config
    diffConfigRight: Config
    diffFileNameLeft: string
    diffFileNameRight: string
    showPipelinePlot: boolean
    configToPlot: Config
    fileMenuOpen: number | null
  }
> {
  private readonly type: FileType = this.props.type
  private timerId: ReturnType<typeof setInterval> | undefined
  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.stopPolling()
      return
    }
    this.startPolling()
    this.update()
  }

  constructor(props: FileTableProps) {
    super(props)
    this.update = this.update.bind(this)
    this.loadActiveConfigName = this.loadActiveConfigName.bind(this)
    this.setActiveConfig = this.setActiveConfig.bind(this)
    this.upload = this.upload.bind(this)
    this.delete = this.delete.bind(this)
    this.downloadAsZip = this.downloadAsZip.bind(this)
    this.overwriteConfig = this.overwriteConfig.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.loadConfig = this.loadConfig.bind(this)
    this.compareConfig = this.compareConfig.bind(this)
    this.compareConfigFiles = this.compareConfigFiles.bind(this)
    this.plotConfig = this.plotConfig.bind(this)
    this.setSelected = this.setSelected.bind(this)
    this.showErrorMessage = this.showErrorMessage.bind(this)
    this.rename = this.rename.bind(this)
    this.toggleFileMenu = this.toggleFileMenu.bind(this)
    this.state = {
      files: [],
      selectedFiles: [],
      activeConfigFileName: null,
      newFileName: "New config.yml",
      fileStatus: null,
      stopTimer: () => {},
      filterText: "",
      showDiffPopup: false,
      diffConfigLeft: {} as Config,
      diffConfigRight: {} as Config,
      diffFileNameLeft: "",
      diffFileNameRight: "",
      showPipelinePlot: false,
      configToPlot: {} as Config,
      fileMenuOpen: null,
    }
  }

  componentDidUpdate() {}

  componentDidMount() {
    this.update()
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    this.startPolling()
    this.loadActiveConfigName()
  }

  componentWillUnmount() {
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
    this.stopPolling()
  }

  private startPolling() {
    if (document.hidden || this.timerId !== undefined) {
      return
    }
    this.timerId = setInterval(this.update, 10000)
  }

  private stopPolling() {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId)
      this.timerId = undefined
    }
  }

  /**
   * Drop the cached coefficients after this table has changed the files on
   * disk. A plot caches what it read by filter name, so a file replaced under
   * a name already in use would otherwise keep plotting its old contents.
   */
  private coefficientFilesChanged() {
    if (this.type === "coeff") clearCoefficientCache()
  }

  private update() {
    loadFiles(this.type).then((files) => {
      if (!isEqual(files, this.state.files)) {
        return this.setState(() => ({
          files: files,
        }))
      }
    })
  }

  private async delete() {
    const del = window.confirm("Delete?\n" + this.state.selectedFiles.map((f) => f.name).join("\n"))
    if (!del) return
    try {
      await deleteFiles(
        this.type,
        this.state.selectedFiles.map((f) => f.name),
      )
      this.setState({ fileStatus: null })
    } catch (e) {
      this.showErrorMessage(EMPTY_FILENAME, "delete", (e as Error).message)
    }
    this.coefficientFilesChanged()
    this.update()
  }

  private downloadAsZip() {
    downloadAsZip(
      this.type,
      this.state.selectedFiles.map((f) => f.name),
      (message) => this.showErrorMessage(EMPTY_FILENAME, "download", message),
    )
  }

  private upload(files: FileList) {
    doUpload(
      this.type,
      files,
      () => {
        this.showSuccess(EMPTY_FILENAME, "upload")
        this.coefficientFilesChanged()
        this.update()
      },
      (message) => this.showErrorMessage(EMPTY_FILENAME, "upload", message),
    )
  }

  private async loadConfig(name: string, migrateLegacyConfig = false) {
    try {
      const loadConfigJsonFn = migrateLegacyConfig ? loadMigratedConfigJson : loadConfigJson
      const jsonConfig = await loadConfigJsonFn(name)
      this.props.setCurrentConfig!(name, jsonConfig)
      this.showSuccess(name, "load")
    } catch (e) {
      const error = e as Error
      const message = error instanceof Error ? error.message : String(error)
      if (migrateLegacyConfig) {
        const importHint = "Please try using the Import config functionality instead."
        const errorMessage = message.toLowerCase().includes("import config") ? message : `${message} ${importHint}`
        this.showErrorMessage(name, "load", errorMessage)
      } else {
        this.showErrorMessage(name, "load", message)
      }
    }
  }

  private async compareConfig(file: FileInfo) {
    const name = file.name
    try {
      const otherConfig = await loadFileConfig(file)
      const guiConfig = this.props.config
      this.setState({
        showDiffPopup: true,
        diffConfigLeft: otherConfig,
        diffConfigRight: guiConfig ? guiConfig : ({} as Config),
        diffFileNameLeft: name,
        diffFileNameRight: "GUI",
      })
    } catch (e) {
      console.log(e)
      const message = e instanceof Error ? e.message : String(e)
      this.showErrorMessage(name, "load", message)
    }
  }

  private async compareConfigFiles(left: FileInfo, right: FileInfo) {
    const name_left = left.name
    const name_right = right.name
    try {
      const leftConfig = await loadFileConfig(left)
      const rightConfig = await loadFileConfig(right)
      this.setState({
        showDiffPopup: true,
        diffConfigLeft: leftConfig,
        diffConfigRight: rightConfig,
        diffFileNameLeft: name_left,
        diffFileNameRight: name_right,
      })
    } catch (e) {
      console.log(e)
      const message = e instanceof Error ? e.message : String(e)
      this.showErrorMessage(name_left + " and " + name_right, "load", message)
    }
  }

  private async plotConfig(file: FileInfo) {
    const name = file.name
    try {
      const config = await loadFileConfig(file)
      this.setState({ showPipelinePlot: true, configToPlot: config })
    } catch (e) {
      console.log(e)
      const message = e instanceof Error ? e.message : String(e)
      this.showErrorMessage(name, "load", message)
    }
  }

  private showSuccess(filename: string, action: FileAction) {
    this.setState({ fileStatus: { filename, action, success: true } })
  }

  private showErrorMessage(filename: string, action: FileAction, errorMessage: string) {
    this.setState({
      fileStatus: {
        filename: filename,
        action: action,
        success: false,
        statusText: errorMessage,
      },
    })
  }

  private async loadActiveConfigName() {
    try {
      const json = await loadActiveConfigFilename()
      this.setState({ activeConfigFileName: json.config_file_name })
    } catch (err) {
      console.log("Failed to get active config", err)
    }
  }

  private setActiveConfig(name: string) {
    api.POST("/api/setactiveconfigfile", { body: { name } }).then(() => this.loadConfig(name))
    this.setState({ activeConfigFileName: name })
  }

  private overwriteConfig(name: string) {
    const del = window.confirm("Overwrite?\n" + name)
    if (!del) return
    this.saveConfig(name)
  }

  private setSelected(selected: { allSelected: boolean; selectedCount: number; selectedRows: FileInfo[] }) {
    this.setState({ selectedFiles: selected.selectedRows })
  }

  private toggleFileMenu(index: number) {
    if (this.state.fileMenuOpen === index) this.setState({ fileMenuOpen: null })
    else this.setState({ fileMenuOpen: index })
  }

  private async saveConfig(name: string) {
    const { config, setCurrentConfig } = this.props
    try {
      const { error, response } = await api.POST("/api/saveconfigfile", { body: { filename: name, config: config! } })
      if (!error) {
        setCurrentConfig!(name, config!)
        this.showSuccess(name, "save")
        if (this.props.saveNotify !== undefined) this.props.saveNotify()
        this.update()
      } else {
        this.showErrorMessage(name, "save", errorMessage(error, response))
      }
    } catch (e) {
      const err = e as Error
      this.showErrorMessage(name, "save", err.message)
    }
  }

  private async rename(filename: string, type: "coeff" | "config") {
    const newName = window.prompt(`Enter a new name for ${filename}`, filename)
    if (newName === filename) return
    if (!newName) return
    try {
      await renameFile(type, filename, newName)
      this.showSuccess(newName, "rename")
      this.coefficientFilesChanged()
      this.update()
    } catch (e) {
      const error = e as Error
      this.showErrorMessage(filename, "rename", error.message)
    }
  }

  render() {
    const {
      files,
      selectedFiles,
      fileStatus,
      newFileName,
      activeConfigFileName,
      filterText,
      showDiffPopup,
      showPipelinePlot,
      configToPlot,
    } = this.state
    const columns: ColumnDef<FileInfo, unknown>[] = []
    if (this.type === "coeff") {
      columns.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div style={{ display: "flex", flexDirection: "row" }}>
            <RenameButton
              filename={row.original.name}
              fileStatus={fileStatus}
              rename={() => this.rename(row.original.name, "coeff")}
            />
          </div>
        ),
        enableSorting: false,
        meta: {
          compact: true,
          width: "42px",
        },
      })
      columns.push({
        id: "filename",
        header: "Filename",
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <div>
            <FileDownloadLink type={this.type} filename={row.original.name} isCurrentConfig={false} />
            <FileStatusMessage filename={row.original.name} fileStatus={fileStatus} type={this.type} />
          </div>
        ),
        sortingFn: sortByRows(fileNameSort),
        meta: {
          compact: true,
        },
      })
    } else if (this.type === "config") {
      columns.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div style={{ display: "flex", flexDirection: "row" }}>
            <SetActiveButton
              active={row.original.name === activeConfigFileName}
              onClick={() => this.setActiveConfig(row.original.name)}
              canUpdate={this.props.canUpdateActiveConfig}
              file={row.original}
            />
            <SaveButton filename={row.original.name} fileStatus={fileStatus} saveConfig={this.overwriteConfig} />
            <LoadButton
              filename={row.original.name}
              fileStatus={fileStatus}
              loadable={row.original.loadable}
              for_version={row.original.version}
              loadConfig={this.loadConfig}
            />
            <div
              className="dropdown"
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "last baseline",
              }}
            >
              <MdiButton
                icon={mdiMenu}
                tooltip="More actions"
                highlighted={this.state.fileMenuOpen === row.index}
                onClick={() => this.toggleFileMenu(row.index)}
              />
              <DropdownBox
                enabled={this.state.fileMenuOpen === row.index}
                onOutsideClick={() => this.toggleFileMenu(row.index)}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "last baseline",
                  }}
                >
                  <RenameButton
                    filename={row.original.name}
                    fileStatus={fileStatus}
                    rename={() => this.rename(row.original.name, "config")}
                  />
                  <CompareToGUIButton file={row.original} compareConfig={this.compareConfig} />
                  <PlotButton
                    tooltip="Plot the pipeline"
                    pipeline={true}
                    enabled={row.original.loadable}
                    onClick={() => this.plotConfig(row.original)}
                  />
                </div>
              </DropdownBox>
            </div>
          </div>
        ),
        enableSorting: false,
        meta: {
          compact: true,
          width: "160px",
        },
      })
      columns.push({
        id: "filename",
        header: "Filename",
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <div>
            <FileDownloadLink
              type={this.type}
              filename={row.original.name}
              isCurrentConfig={row.original.name === this.props.currentConfigFile}
            />
            <FileStatusMessage filename={row.original.name} fileStatus={fileStatus} type={this.type} />
          </div>
        ),
        sortingFn: sortByRows(fileNameSort),
        meta: {
          width: "250px",
          compact: true,
        },
      })
      columns.push({
        id: "title",
        header: "Title",
        accessorFn: (row) => row.title || row.description || "",
        cell: ({ row }) => (
          <div data-tooltip-html={row.original.description} data-tooltip-id="main-tooltip">
            {row.original.title ? (
              row.original.title
            ) : row.original.description ? (
              <i>{row.original.description.slice(0, 20) + "..."}</i>
            ) : null}
          </div>
        ),
        sortingFn: sortByRows(fileTitleSort),
        meta: {
          maxWidth: "150px",
          compact: true,
        },
      })
      columns.push({
        id: "valid",
        header: "Valid",
        accessorFn: (row) => row.valid,
        cell: ({ row }) => (
          <div data-tooltip-html={fileStatusDesc(row.original)} data-tooltip-id="main-tooltip">
            {CONFIG_FILE_STATUS_ICONS[configFileStatus(row.original)]}
          </div>
        ),
        sortingFn: sortByRows(fileValidSort),
        meta: {
          width: "60px",
          compact: true,
        },
      })
      columns.push({
        id: "version",
        header: "Version",
        accessorFn: (row) => (row.version === null || row.version === undefined ? "" : row.version),
        meta: {
          width: "60px",
          compact: true,
        },
      })
    }
    columns.push({
      id: "date",
      header: "Date",
      accessorFn: (row) => row.formattedDate,
      sortingFn: sortByRows(fileDateSort),
      meta: {
        width: "110px",
        compact: true,
      },
    })
    columns.push({
      id: "size",
      header: "Size",
      accessorFn: (row) => row.size,
      meta: {
        width: "60px",
        compact: true,
        right: true,
      },
    })
    return (
      <Box title={this.props.title}>
        <div>
          <div>
            <FileStatusMessage filename={EMPTY_FILENAME} fileStatus={fileStatus} type={this.type} />
          </div>

          <DataTable
            columns={columns}
            data={files}
            globalFilter={filterText}
            toolbar={
              <>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "4px" }}>
                  <DownloadFilesAsZipButton
                    selectedFiles={selectedFiles.map((f) => f.name)}
                    downloadAsZip={this.downloadAsZip}
                  />
                  <DeleteFilesButton selectedFiles={selectedFiles.map((f) => f.name)} delete={this.delete} />
                  {this.props.type === "config" && (
                    <CompareFilesButton
                      key="comparefiles"
                      selectedFiles={selectedFiles}
                      compareConfigs={this.compareConfigFiles}
                    />
                  )}
                  <UploadFilesButton fileStatus={fileStatus} upload={this.upload} />
                </div>
                <input
                  type="search"
                  placeholder="Filter files"
                  value={filterText}
                  data-tooltip-html="Enter a search string to filter files"
                  data-tooltip-id="main-tooltip"
                  spellCheck="false"
                  onChange={(e) => this.setState({ filterText: e.target.value })}
                />
              </>
            }
            selectableRows
            onSelectedRowsChange={this.setSelected}
          />

          {
            // "Save to new config" row
            this.type === "config" && (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <SaveButton
                    disableReason={reasonToDisableSaveNewFileButton(newFileName, files)}
                    filename={newFileName}
                    fileStatus={fileStatus}
                    saveConfig={this.saveConfig}
                  />
                  <input
                    type="text"
                    value={newFileName}
                    data-tooltip-html="Enter a name for the new config file"
                    data-tooltip-id="main-tooltip"
                    spellCheck="false"
                    onChange={(e) =>
                      this.setState({
                        newFileName: e.target.value,
                      })
                    }
                  />
                  <FileStatusMessage filename={newFileName} fileStatus={fileStatus} type={this.type} />
                </div>
              </>
            )
          }
        </div>
        <DiffPopup
          open={showDiffPopup}
          onClose={() =>
            this.setState({
              showDiffPopup: false,
              diffFileNameLeft: "",
              diffConfigLeft: {} as Config,
              diffConfigRight: {} as Config,
              diffFileNameRight: "",
            })
          }
          left_config={this.state.diffConfigLeft}
          left_name={this.state.diffFileNameLeft}
          right_config={this.state.diffConfigRight}
          right_name={this.state.diffFileNameRight}
        />
        <PipelinePopup
          key={showPipelinePlot ? "1" : "0"}
          open={showPipelinePlot}
          config={configToPlot}
          onClose={() =>
            this.setState({
              showPipelinePlot: false,
              configToPlot: {} as Config,
            })
          }
        />
      </Box>
    )
  }
}

function isOlderVersion(version: number | null | undefined): boolean {
  return version !== null && version !== undefined && version < CURRENT_CONFIG_VERSION
}

/** A config file as the GUI loads it, migrated first if it is for an older version. */
function loadFileConfig(file: FileInfo): Promise<Config> {
  return isOlderVersion(file.version) ? loadMigratedConfigJson(file.name) : loadConfigJson(file.name)
}

function SetActiveButton(props: { active: boolean; onClick: () => void; canUpdate?: boolean; file: FileInfo }) {
  const { active, onClick, canUpdate, file } = props
  let disabledReason = ""
  if (canUpdate === false) {
    disabledReason =
      "Disabled since the backend is not able to store the active config file.<br>Check the backend configuration."
  } else if (file.loadable !== true) {
    disabledReason = "Disabled since this config file cannot be loaded."
  } else if (file.version !== CURRENT_CONFIG_VERSION) {
    disabledReason =
      "Disabled since this config file is made for an older version of CamillaDSP.<br>Load it and save it to migrate it first."
  }
  const enabled = !disabledReason
  let tooltip
  if (!enabled) {
    tooltip = `Mark this config file as active.<br>${disabledReason}`
  } else {
    if (active) {
      tooltip = "This config file is marked as active."
    } else {
      tooltip = "Mark this config file as active, and load it into the GUI."
    }
  }

  return (
    <MdiButton
      enabled={enabled}
      icon={active ? mdiStar : mdiStarOutline}
      tooltip={tooltip}
      highlighted={active}
      onClick={onClick}
    />
  )
}

function SaveButton(props: {
  filename: string
  disableReason?: string
  fileStatus: FileStatus | null
  saveConfig: (filename: string) => void
}) {
  const { disableReason, filename, fileStatus, saveConfig } = props
  let saveIcon: { icon: string; className?: string } = {
    icon: mdiContentSave,
  }
  if (!disableReason && fileStatus !== null && fileStatus.action === "save" && fileStatus.filename === filename) {
    saveIcon = fileStatus.success
      ? { icon: mdiCheck, className: "success-text" }
      : { icon: mdiAlertCircle, className: "error-text" }
  }
  return (
    <MdiButton
      icon={saveIcon.icon}
      className={saveIcon.className}
      enabled={!disableReason}
      tooltip={disableReason ? disableReason : `Save from GUI to ${filename}`}
      onClick={() => saveConfig(filename)}
    />
  )
}

function LoadButton(props: {
  filename: string
  fileStatus: FileStatus | null
  loadConfig: (filename: string, migrateLegacyConfig: boolean) => void
  loadable: boolean | undefined
  for_version: number | null | undefined
}) {
  const { filename, fileStatus, loadConfig, loadable, for_version } = props
  const isLatestVersion = for_version === CURRENT_CONFIG_VERSION
  const shouldMigrate = isOlderVersion(for_version)

  let loadIcon: { icon: string; className?: string } = {
    icon: isLatestVersion ? mdiOpenInApp : mdiRefresh,
  }
  if (fileStatus !== null && fileStatus.action === "load" && fileStatus.filename === filename) {
    loadIcon = fileStatus.success
      ? { icon: mdiCheck, className: "success-text" }
      : { icon: mdiAlertCircle, className: "error-text" }
  }

  const tooltipAction = shouldMigrate
    ? `Load "${filename}" into the GUI with automatic migration.`
    : `Load "${filename}" into the GUI.`
  const disabledReason = loadable ? "" : "<br>Disabled because this config file cannot be loaded."

  return (
    <MdiButton
      icon={loadIcon.icon}
      className={loadIcon.className}
      tooltip={`${tooltipAction}${disabledReason}`}
      enabled={loadable === true}
      onClick={() => loadConfig(filename, shouldMigrate)}
    />
  )
}

function CompareToGUIButton(props: { file: FileInfo; compareConfig: (file: FileInfo) => void }) {
  const { file, compareConfig } = props
  const loadIcon: { icon: string; className?: string } = {
    icon: mdiScaleUnbalanced,
  }
  let disabled_reason = ""
  if (!file.loadable) {
    disabled_reason = "<br>Disabled because this config file cannot be loaded."
  }
  return (
    <MdiButton
      icon={loadIcon.icon}
      className={loadIcon.className}
      tooltip={`Compare ${file.name} with config in GUI${disabled_reason}`}
      enabled={file.loadable === true}
      onClick={() => compareConfig(file)}
    />
  )
}

function CompareFilesButton(props: {
  selectedFiles: FileInfo[]
  compareConfigs: (left: FileInfo, right: FileInfo) => void
}) {
  const { selectedFiles, compareConfigs } = props
  const loadIcon: { icon: string; className?: string } = {
    icon: mdiScaleUnbalanced,
  }
  const enabled = selectedFiles.length === 2 && !!selectedFiles[0].loadable && !!selectedFiles[1].loadable
  let tooltip
  if (enabled) {
    tooltip = `Compare ${selectedFiles[0].name} and ${selectedFiles[1].name}`
  } else {
    tooltip = "Select two loadable files to compare"
  }
  return (
    <MdiButton
      icon={loadIcon.icon}
      className={loadIcon.className}
      tooltip={tooltip}
      enabled={enabled}
      onClick={() => compareConfigs(selectedFiles[0], selectedFiles[1])}
    />
  )
}

function FileDownloadLink(props: { type: string; filename: string; isCurrentConfig: boolean }) {
  const { type, filename, isCurrentConfig } = props
  const tooltip =
    "Download " + filename + (isCurrentConfig ? "<br>This is the config file currently loaded in this Editor" : "")

  return (
    <button
      type="button"
      className="file-link"
      style={{ width: "max-content" }}
      data-tooltip-html={tooltip}
      data-tooltip-id="main-tooltip"
      onClick={() => {
        void downloadFromUrl(filename, `/${type}/${encodeURIComponent(filename)}`)
      }}
    >
      {filename}
    </button>
  )
}

function reasonToDisableSaveNewFileButton(newFileName: string, files: FileInfo[]): string | undefined {
  if (!isValidFilename(newFileName)) return "Please enter a valid file name."
  else if (fileNamesOf(files).includes(newFileName)) return `File "${newFileName}" already exists`
  return undefined
}

function isValidFilename(newFileName: string) {
  return newFileName.trim().length > 0
}

interface NewConfigProps {
  currentConfig: Config
  setCurrentConfig?: (filename: string | undefined, config: Config) => void
  updateConfig: (update: Update<Config>) => void
}

class NewConfig extends Component<NewConfigProps, { importPopupProps: ImportPopupProps }> {
  constructor(props: NewConfigProps) {
    super(props)
    this.loadDefaultConfig = this.loadDefaultConfig.bind(this)
    this.state = { importPopupProps: {} }
  }

  componentDidUpdate() {
    //ReactTooltip.rebuild()
  }

  private async loadDefaultConfig() {
    try {
      const config = await loadDefaultConfigJson()
      this.props.setCurrentConfig!(undefined, config)
    } catch (e) {
      console.log(e)
    }
  }

  private loadBlankConfig() {
    const config = defaultConfig()
    this.props.setCurrentConfig!(undefined, config)
  }

  private openImportConfigPopup() {
    this.setState({
      importPopupProps: {
        currentConfig: this.props.currentConfig,
        updateConfig: this.props.updateConfig,
        close: () => this.setState({ importPopupProps: {} }),
      },
    })
  }

  render() {
    return (
      <Box title="Create or import config">
        <div
          style={{
            marginTop: "10px",
            display: "grid",
            alignItems: "center",
            gridTemplateColumns: "40% 28% 28%",
            columnGap: "2%",
          }}
        >
          <Button
            text="New config from default"
            onClick={() => this.loadDefaultConfig()}
            enabled={true}
            tooltip="Create and load a new config using the default config as a template.<br>Any unsaved changes will be lost."
          />
          <Button
            text="New blank config"
            onClick={() => this.loadBlankConfig()}
            enabled={true}
            tooltip="Create and load a new blank config.<br>Any unsaved changes will be lost."
          />
          <Button
            text="Import config"
            onClick={() => this.openImportConfigPopup()}
            enabled={true}
            tooltip="Import items from another config into this one."
          />
        </div>
        <ImportPopup {...this.state.importPopupProps} />
      </Box>
    )
  }
}
