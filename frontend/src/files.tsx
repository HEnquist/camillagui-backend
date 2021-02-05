import React, {ChangeEvent, Component} from "react"
import {Set} from "immutable"
import {FLASKURL} from "./index"
import {Box, CheckBox, download, MdiButton, UploadButton} from "./common-tsx"
import {mdiAlertCircle, mdiCheck, mdiContentSave, mdiDelete, mdiDownload, mdiRefresh, mdiUpload} from '@mdi/js'
import {Config} from "./config";
import ReactTooltip from "react-tooltip";

export function Files(props: {
  activeConfigFile?: string,
  config: Config,
  setActiveConfig: (filename: string, config: Config) => void
}) {
  return <>
    <FileTable title='Configs'
               type="config"
               activeConfigFile={props.activeConfigFile}
               config={props.config}
               setActiveConfig={props.setActiveConfig}/>
    <FileTable title='Filters' type="coeff"/>
  </>
}

interface FileTableProps {
  title: string,
  type: "config" | "coeff",
  activeConfigFile?: string,
  config?: Config
  setActiveConfig?: (filename: string, config: Config) => void
}

type FileAction = 'load' | 'save' | 'upload'
const EMPTY_FILENAME = '' // used only for FileAction 'upload'
type FileStatus =
    {
      filename: string,
      action: FileAction,
      success: true
    } |
    {
      filename: string,
      action: FileAction,
      success: false,
      statusText: string
    }

class FileTable extends Component<
    FileTableProps,
    {
      files: ReadonlyArray<string>,
      selectedFiles: Set<string>,
      newFileName: string,
      fileStatus: FileStatus | null,
      stopTimer: () => void
    }> {

  private readonly type: "config" | "coeff" = this.props.type
  private readonly canLoadAndSave: boolean = this.type === "config"

  constructor(props: FileTableProps) {
    super(props)
    this.update = this.update.bind(this)
    this.toggleAllFileSelection = this.toggleAllFileSelection.bind(this)
    this.toggleFileSelection = this.toggleFileSelection.bind(this)
    this.areAllFilesSelected = this.areAllFilesSelected.bind(this)
    this.upload = this.upload.bind(this)
    this.delete = this.delete.bind(this)
    this.downloadAsZip = this.downloadAsZip.bind(this)
    this.overwriteConfig = this.overwriteConfig.bind(this)
    this.saveConfig = this.saveConfig.bind(this)
    this.loadConfig = this.loadConfig.bind(this)
    this.showErrorMessage = this.showErrorMessage.bind(this)
    this.state = {
      files: [],
      selectedFiles: Set(),
      newFileName: 'New config.yml',
      fileStatus: null,
      stopTimer: () => {}
    }
  }

  componentDidUpdate() {
    ReactTooltip.rebuild();
  }

  componentDidMount() {
    this.update()
    const timerId = setInterval(this.update, 1000);
    this.setState({stopTimer: () => clearInterval(timerId)})
  }

  componentWillUnmount() {
    this.state.stopTimer()
  }

  private update() {
    fetch(`${FLASKURL}/api/stored${this.type}s`)
      .then(response => response.json())
      .then(json => this.setState((prevState) => {
        let files = json as string[];
        return {
          files: files,
          selectedFiles: prevState.selectedFiles.intersect(files)
        };
      }))
  }

  private async delete() {
    const del = window.confirm("Delete?\n" + this.state.selectedFiles.join('\n'))
    if (!del)
      return
    await fetch(`${FLASKURL}/api/delete${this.type}s`, {
      method: "POST",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify(this.state.selectedFiles),
    })
    this.setState({fileStatus: null})
  }

  private async downloadAsZip() {
    const response = await fetch(`${FLASKURL}/api/download${this.type}szip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify(this.state.selectedFiles),
    })
    const zipFile = await response.blob();
    download(this.type + 's.zip', zipFile);
  }

  private async upload(event: ChangeEvent<HTMLInputElement>) {
    const formData = new FormData()
    const files = event.target.files as FileList
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      formData.append("file"+index, file, file.name)
    }
    event.target.value = '' // this resets the upload field, so the same file can be uploaded twice in a row
    try {
      await fetch(`${FLASKURL}/api/upload${this.type}s`, {
        method: "POST",
        body: formData
      })
      this.setState({fileStatus: {filename: EMPTY_FILENAME, action: 'upload', success: true}})
    } catch (e) {
      this.setState({fileStatus: {filename: EMPTY_FILENAME, action: 'upload', success: false, statusText: e.message}})
    }
  }

  private async loadConfig(name: string) {
    try {
      const response = await fetch(`${FLASKURL}/api/getconfigfile?name=${encodeURIComponent(name)}`)
      if (!response.ok) {
        this.showErrorMessage(name, 'load', await response.text())
        return
      }
      const jsonConfig = await response.json()
      this.props.setActiveConfig!(name, jsonConfig as Config);
      this.setState({fileStatus: {filename: name, action: 'load', success: true}})
    } catch(e) {
      this.showErrorMessage(name, 'load', e);
    }
  }

  private showErrorMessage(filename: string, action: FileAction, errorMessage: string) {
    this.setState({
      fileStatus: {filename: filename, action: action, success: false, statusText: errorMessage}
    })
  }

  private overwriteConfig(name: string) {
    const del = window.confirm("Overwrite?\n" + name)
    if (!del)
      return
    this.saveConfig(name)
  }

  private async saveConfig(name: string) {
    const { config, setActiveConfig } = this.props
    try {
      const response = await fetch(`${FLASKURL}/api/saveconfigfile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", },
        body: JSON.stringify({filename: name, config: config}),
      });
      if (response.ok) {
        setActiveConfig!(name, config)
        this.setState({fileStatus: {filename: name, action: 'save', success: true}})
      } else {
        const message = await response.text();
        this.showErrorMessage(name, 'save', message)
      }
    } catch (e) {
      this.showErrorMessage(name, 'save', e.message)
    }
  }

  private toggleAllFileSelection() {
    this.setState(prevState => {
      let files = prevState.files
      const newSelection = this.areAllFilesSelected() ? Set() : Set(files)
      return Object.assign({}, prevState, {selectedFiles: newSelection})
    })
  }

  private toggleFileSelection(filename: string) {
    this.setState(prevState => {
      const selection = prevState.selectedFiles
      const newSelection = selection.has(filename) ? selection.delete(filename) : selection.add(filename)
      return Object.assign({}, prevState, {selectedFiles: newSelection})
    })
  }

  private areAllFilesSelected(): boolean {
    const { files, selectedFiles } = this.state
    return files.length > 1 && selectedFiles.isSuperset(files)
  }

  render() {
    const {files, selectedFiles, fileStatus, newFileName} = this.state
    return (
      <Box title={this.props.title}>
        <div style={{
          display: 'grid',
          alignItems: 'center',
          gridTemplateColumns: 'min-content min-content min-content min-content'
        }}>

          {/* Header row */}
          <FileCheckBox
              filename={"all files"}
              checked={this.areAllFilesSelected()}
              onChange={this.toggleAllFileSelection}/>
          <DownloadFilesAsZipButton selectedFiles={selectedFiles} downloadAsZip={this.downloadAsZip}/>
          <DeleteFilesButton selectedFiles={selectedFiles} delete={this.delete}/>
          <div>
            <UploadFilesButton fileStatus={fileStatus} upload={this.upload}/>
            <FileStatusMessage filename={EMPTY_FILENAME} fileStatus={fileStatus}/>
          </div>

          { // File rows
            files.flatMap(filename => [
                  <FileCheckBox
                      key={filename+'(1)'}
                      filename={filename}
                      checked={selectedFiles.has(filename)}
                      onChange={() => this.toggleFileSelection(filename)}/>,
                  !this.canLoadAndSave ? null : <SaveButton
                      key={filename+'(2)'}
                      filename={filename}
                      fileStatus={fileStatus}
                      saveConfig={this.overwriteConfig}/>,
                  !this.canLoadAndSave ? null : <LoadButton
                      key={filename+'(3)'}
                      filename={filename}
                      fileStatus={fileStatus}
                      loadConfig={this.loadConfig}/>,
                  <div key={filename+'(4)'} style={this.canLoadAndSave ? {} : {gridColumn: '2 / span 3'}}>
                    <FileDownloadButton type={this.type}
                                        filename={filename}
                                        highlight={this.props.activeConfigFile === filename}/>
                    <FileStatusMessage filename={filename} fileStatus={fileStatus}/>
                  </div>
                ]
            )
          }

          { // "Save to new config" row
            this.canLoadAndSave && <>
            <div/>
            <SaveButton
                disableReason={reasonToDisableSaveNewFileButton(newFileName, files)}
                filename={newFileName}
                fileStatus={fileStatus}
                saveConfig={this.saveConfig}/>
            <div/>
            <div>
              <input type='text'
                     value={newFileName}
                     data-tip="Enter a name for the new config file"
                     style={{width: 'auto', margin: '5px 3px', padding: '3px 6px'}}
                     onChange={(e) => this.setState({newFileName: e.target.value})}/>
              <FileStatusMessage filename={newFileName} fileStatus={fileStatus}/>
            </div>
          </>
          }
        </div>
      </Box>
    )
  }
}

function FileCheckBox(props: {checked: boolean, filename: string, onChange: () => void}) {
  const {checked, filename, onChange} = props
  let tooltip = (checked ? "Unselect " : "Select ") + filename;
  return <CheckBox tooltip={tooltip} checked={checked} onChange={onChange}/>
}

function DownloadFilesAsZipButton(props: { selectedFiles: Set<string>, downloadAsZip: () => {} }) {
  const {selectedFiles, downloadAsZip} = props
  const fileOrFiles = selectedFiles.size > 1 ? 'files' : 'file'
  return <MdiButton
      icon={mdiDownload}
      tooltip={selectedFiles.isEmpty()
          ? 'Select files to download'
          : `Download ${selectedFiles.size} ${fileOrFiles} as zip file`}
      enabled={!selectedFiles.isEmpty()}
      onClick={downloadAsZip}/>
}

function DeleteFilesButton(props: { selectedFiles: Set<string>, delete: () => {} }) {
  const selectedFiles = props.selectedFiles
  const fileOrFiles = selectedFiles.size > 1 ? 'files' : 'file'
  return <MdiButton
      icon={mdiDelete}
      tooltip={selectedFiles.isEmpty()
          ? 'Select files to delete'
          : `Delete ${selectedFiles.size} ${fileOrFiles}`}
      enabled={!selectedFiles.isEmpty()}
      onClick={props.delete}/>
}

function UploadFilesButton(props: {
  fileStatus: FileStatus | null,
  upload: (e: ChangeEvent<HTMLInputElement>) => {}
}) {
  const fileStatus = props.fileStatus
  let uploadIcon: { icon: string, className?: string } =
      {icon: mdiUpload}
  if (fileStatus !== null && fileStatus.action === 'upload' && fileStatus.filename === EMPTY_FILENAME)
    uploadIcon = fileStatus.success ?
        {icon: mdiCheck, className: 'success'}
        : {icon: mdiAlertCircle, className: 'error'}
  return <UploadButton
      content={<MdiButton icon={uploadIcon.icon} tooltip={'Upload files'} className={uploadIcon.className}/>}
      tooltip={''}
      onChange={props.upload}
      multiple={true}/>
}

function SaveButton(
    props: {
      filename: string,
      disableReason?: string,
      fileStatus: FileStatus | null,
      saveConfig: (filename: string) => void
    }
) {
  const { disableReason, filename, fileStatus, saveConfig } = props
  let saveIcon: { icon: string, className?: string } =
      {icon: mdiContentSave}
  if (!disableReason && fileStatus !== null && fileStatus.action === 'save' && fileStatus.filename === filename) {
    saveIcon = fileStatus.success ?
        {icon: mdiCheck, className: 'success'}
        : {icon: mdiAlertCircle, className: 'error'}
  }
  return <MdiButton
      icon={saveIcon.icon}
      className={saveIcon.className}
      enabled={!disableReason}
      tooltip={disableReason ? disableReason : `Save to ${filename}`}
      onClick={() => saveConfig(filename)}/>
}

function LoadButton(
    props: {
      filename: string,
      fileStatus: FileStatus | null,
      loadConfig: (filename: string) => void
    }
) {
  const { filename, fileStatus, loadConfig } = props
  let loadIcon: { icon: string, className?: string } =
      {icon: mdiRefresh}
  if (fileStatus !== null && fileStatus.action === 'load' && fileStatus.filename === filename) {
    loadIcon = fileStatus.success ?
        {icon: mdiCheck, className: 'success'}
        : {icon: mdiAlertCircle, className: 'error'}
  }
  return <MdiButton
      icon={loadIcon.icon}
      className={loadIcon.className}
      tooltip={`Load ${filename}`}
      onClick={() => loadConfig(filename)}/>
}

function FileDownloadButton(props: { type: string, filename: string, highlight: boolean }) {
  const { type, filename, highlight } = props
  const classNames = highlight ? 'button highlighted' : 'button'
  return <a className={classNames}
            style={{width: 'max-content', textDecoration: 'none', color: 'black'}}
            data-tip={'Download '+filename}
            href={`${FLASKURL}/${type}/${filename}`}>
    {filename}
  </a>
}

function FileStatusMessage(props: { filename: string, fileStatus: FileStatus | null }) {
  const {fileStatus, filename} = props
  if (fileStatus && !fileStatus.success && fileStatus.filename === filename)
    return <div className={fileStatus.success ? 'success' : 'error'}>
      Could not {fileStatus.action} config:<br/>
      {fileStatus.statusText}
    </div>
  else
    return null
}

function reasonToDisableSaveNewFileButton(newFileName: string, files: ReadonlyArray<string>): string | undefined {
  if (!isValidFilename(newFileName))
    return 'Please enter a valid file name.'
  else if (files.includes(newFileName))
    return `File "${newFileName}" already exists`
  return undefined;
}

function isValidFilename(newFileName: string) {
  return newFileName.trim().length > 0;
}