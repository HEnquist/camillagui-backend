import React, { Component } from "react"
import { mdiAlertCircle, mdiCheck, mdiFileImport, mdiMenu, mdiScaleUnbalanced, mdiStar, mdiUpdate } from "@mdi/js"
import { ColumnDef } from "@tanstack/react-table"
import { isEqual } from "lodash"
import { Config } from "./camilladsp/config"
import { clearCoefficientCache } from "./camilladsp/eval"
import { ControllerStatus } from "./camilladsp/status"
import { GuiConfig } from "./guiconfig"
import { PipelinePopup } from "./pipeline/pipelineplotter"
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
  coeffFileErrorDesc,
  CONFIG_FILE_STATUS_ICONS,
  configFileStatus,
  deleteFiles,
  doUpload,
  downloadAsZip,
  downloadFromUrl,
  FileInfo,
  fileStatusDesc,
  loadActiveConfigFilename,
  loadConfigJson,
  loadFiles,
  renameFile,
  StoredFileType,
  subscribeFileChanges,
} from "./utilities/files"
import {
  Box,
  DropdownBox,
  ErrorBoundary,
  fileDateSort,
  fileNameSort,
  fileTitleSort,
  fileValidSort,
  MdiButton,
  MdiIcon,
  PlotButton,
} from "./utilities/ui-components"

/**
 * The config and filter files available to CamillaDSP: uploading, downloading, renaming and
 * deleting them, and loading a config into the editor, which then shows the Edit area. Saving
 * the editor's config, and new and imported configs, are in the side panel's Editor box.
 */
export function Files(props: {
  guiConfig: GuiConfig
  currentConfigFile?: string
  config: Config
  setCurrentConfig: (filename: string | undefined, config: Config) => void
  /** Show the editor, after a config was loaded into it. */
  showEditor: () => void
  controllerStatus: ControllerStatus | null
}) {
  const controller = props.controllerStatus
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="wide-tabpanel" style={{ width: "900px" }}>
          <FileTable
            title="Configs"
            type="config"
            currentConfigFile={props.currentConfigFile}
            config={props.config}
            setCurrentConfig={props.setCurrentConfig}
            showEditor={props.showEditor}
            activeConfigFile={controller?.startup_config_file}
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
  /**
   * The active config file, from the controller status, which follows changes made elsewhere.
   * Without it, the name read when the table is shown.
   */
  activeConfigFile?: string | null
  setCurrentConfig?: (filename: string, config: Config) => void
  showEditor?: () => void
}

class FileTable extends Component<
  FileTableProps,
  {
    files: FileInfo[]
    /** Whether the files have been listed once. */
    loaded: boolean
    selectedFiles: FileInfo[]
    activeConfigFileName: string | null
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
  private unsubscribeFileChanges?: () => void

  constructor(props: FileTableProps) {
    super(props)
    this.update = this.update.bind(this)
    this.loadActiveConfigName = this.loadActiveConfigName.bind(this)
    this.upload = this.upload.bind(this)
    this.delete = this.delete.bind(this)
    this.downloadAsZip = this.downloadAsZip.bind(this)
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
      loaded: false,
      selectedFiles: [],
      activeConfigFileName: null,
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
    this.unsubscribeFileChanges = subscribeFileChanges((kind) => {
      // A config's validity depends on the filter files it uses.
      if (kind === this.type || (this.type === "config" && kind === "coeff")) this.update()
    })
    this.update()
    this.loadActiveConfigName()
  }

  componentWillUnmount() {
    this.unsubscribeFileChanges?.()
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
      if (!this.state.loaded || !isEqual(files, this.state.files)) {
        return this.setState(() => ({
          files: files,
          loaded: true,
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

  private async loadConfig(name: string, outdated = false) {
    try {
      const jsonConfig = await loadConfigJson(name)
      this.props.setCurrentConfig!(name, jsonConfig)
      this.showSuccess(name, "load")
      this.props.showEditor?.()
    } catch (e) {
      const error = e as Error
      const message = error instanceof Error ? error.message : String(error)
      if (outdated) {
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
      const otherConfig = await loadConfigJson(name)
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
      const leftConfig = await loadConfigJson(name_left)
      const rightConfig = await loadConfigJson(name_right)
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
      const config = await loadConfigJson(name)
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

  private setSelected(selected: { allSelected: boolean; selectedCount: number; selectedRows: FileInfo[] }) {
    this.setState({ selectedFiles: selected.selectedRows })
  }

  private toggleFileMenu(index: number) {
    if (this.state.fileMenuOpen === index) this.setState({ fileMenuOpen: null })
    else this.setState({ fileMenuOpen: index })
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
      activeConfigFileName,
      filterText,
      showDiffPopup,
      showPipelinePlot,
      configToPlot,
    } = this.state
    const activeConfigFile = this.props.activeConfigFile ?? activeConfigFileName
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
      columns.push({
        id: "sampleformat",
        header: "Format",
        accessorFn: (row) => row.sampleformat ?? "",
        cell: ({ row }) =>
          row.original.valid === false ? (
            <div data-tooltip-html={coeffFileErrorDesc(row.original)} data-tooltip-id="main-tooltip">
              {CONFIG_FILE_STATUS_ICONS.errors} {row.original.sampleformat ?? ""}
            </div>
          ) : (
            (row.original.sampleformat ?? "")
          ),
        meta: { width: "100px", compact: true },
      })
      columns.push({
        id: "samplerate",
        header: "Rate",
        accessorFn: (row) => row.samplerate ?? null,
        cell: ({ row }) => row.original.samplerate ?? "",
        sortingFn: sortByRows((a, b) => (a.samplerate ?? -1) - (b.samplerate ?? -1)),
        meta: { width: "70px", compact: true, right: true },
      })
      columns.push({
        id: "channels",
        header: "Ch",
        accessorFn: (row) => row.channels ?? null,
        cell: ({ row }) => row.original.channels ?? "",
        sortingFn: sortByRows((a, b) => (a.channels ?? -1) - (b.channels ?? -1)),
        meta: { width: "40px", compact: true, right: true },
      })
      columns.push({
        id: "length",
        header: "Length",
        accessorFn: (row) => row.length ?? null,
        cell: ({ row }) => row.original.length ?? "",
        sortingFn: sortByRows((a, b) => (a.length ?? -1) - (b.length ?? -1)),
        meta: { width: "80px", compact: true, right: true },
      })
    } else if (this.type === "config") {
      columns.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div style={{ display: "flex", flexDirection: "row" }}>
            <LoadButton
              filename={row.original.name}
              fileStatus={fileStatus}
              loadable={row.original.loadable}
              outdated={row.original.outdated === true}
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
          width: "120px",
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
            {row.original.name === activeConfigFile && (
              <MdiIcon
                icon={mdiStar}
                tooltip="The startup config, which CamillaDSP loads when it starts or reloads.<br>A change saved to it runs at the next reload or restart."
                style={{ marginLeft: "5px" }}
              />
            )}
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
            placeholder={this.state.loaded ? undefined : "Loading…"}
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

function LoadButton(props: {
  filename: string
  fileStatus: FileStatus | null
  loadConfig: (filename: string, outdated: boolean) => void
  loadable: boolean | undefined
  outdated: boolean
}) {
  const { filename, fileStatus, loadConfig, loadable, outdated } = props

  let loadIcon: { icon: string; className?: string } = {
    icon: outdated ? mdiUpdate : mdiFileImport,
  }
  if (fileStatus !== null && fileStatus.action === "load" && fileStatus.filename === filename) {
    loadIcon = fileStatus.success
      ? { icon: mdiCheck, className: "success-text" }
      : { icon: mdiAlertCircle, className: "error-text" }
  }

  const tooltipAction = outdated
    ? `Load "${filename}" into the editor with automatic migration.`
    : `Load "${filename}" into the editor.`
  const disabledReason = loadable ? "" : "<br>Disabled because this config file cannot be loaded."

  return (
    <MdiButton
      icon={loadIcon.icon}
      className={loadIcon.className}
      tooltip={`${tooltipAction}${disabledReason}`}
      enabled={loadable === true}
      onClick={() => loadConfig(filename, outdated)}
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
