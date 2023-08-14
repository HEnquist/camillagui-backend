import React, {useEffect, useState} from "react"
import {Button, UploadButton} from "./utilities/ui-components"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config, Devices, Filters, Mixers, Pipeline, Processors} from "./camilladsp/config"
import {merge} from "lodash"
import {Update} from "./utilities/common"

interface ImportConfig {
  devices?: Devices
  filters?: Filters
  mixers?: Mixers
  processors?: Processors
  pipeline?: Pipeline
  title: string | null
  description: string | null
}

export class ImportTab extends React.Component<
    {
      config: Config
      updateConfig: (update: Update<Config>) => void
    },
    {
      importConfig?: ImportConfig
    }
> {
  constructor(props: any) {
    super(props)
    this.setImportConfig = this.setImportConfig.bind(this)
    this.state = {}
  }

  private setImportConfig(config: ImportConfig) {
    this.setState({importConfig: config})
  }

  render() {
    const {config, updateConfig} = this.props
    const {importConfig} = this.state
    return importConfig ?
        <ConfigItemSelection
            config={importConfig}
            import={importConfig => updateConfig(config => merge(config, importConfig))}
            cancel={() => this.setState({importConfig: undefined})}
        />
        : <FileList setImportConfig={this.setImportConfig}/>
  }

}

function FileList(props: {
  setImportConfig: (config: Config) => void
}) {
  const [fileList, setFileList] = useState<string[]>([])
  useEffect(() => {
    loadFilenames('config').then(files => setFileList(files))
  })
  return <div className="wide-tabpanel">
    <div className="horizontally-spaced-content">
      <UploadButton text="Import CamillaDSP Config" upload={files => {files[0]}}/>
      <UploadButton text="Import Equalizer APO Config" upload={files => {}}/>
      <UploadButton text="Import REW Config" upload={() => {}}/>
    </div>
    <p>
      {fileList.map(file =>
          <>
            <Button style={{marginBottom:'5px'}} key={file} text={file} onClick={() => {
              loadConfigJson(file)
                  .then(config => props.setImportConfig(config))
            }}/>
            <br/>
          </>
      )}
    </p>
  </div>
}

function ConfigItemSelection(props: {
  config: ImportConfig
  import: (importConfig: ImportConfig) => void
  cancel: () => void
}) {
  return <>
    <pre>{JSON.stringify(props.config, null, 2)}</pre>
    <div className="horizontally-spaced-content">
      <Button text="Import" onClick={() => props.import(props.config)}/>
      <Button text="Cancel" onClick={props.cancel}/>
    </div>
  </>
}