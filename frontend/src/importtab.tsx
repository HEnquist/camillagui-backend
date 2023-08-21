import React, {useEffect, useState} from "react"
import {Button, UploadButton} from "./utilities/ui-components"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {merge} from "lodash"
import {Update} from "./utilities/common"
import {ImportedConfig, importedEqApoConfigAsJson, importedYamlConfigAsJson} from "./utilities/configimport"

export class ImportTab extends React.Component<
    {
      config: Config
      updateConfig: (update: Update<Config>) => void
    },
    {
      importConfig?: ImportedConfig
    }
> {
  constructor(props: any) {
    super(props)
    this.setImportConfig = this.setImportConfig.bind(this)
    this.state = {}
  }

  private setImportConfig(config: ImportedConfig) {
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
  setImportConfig: (config: ImportedConfig) => void
}) {
  const {setImportConfig} = props
  const [fileList, setFileList] = useState<string[]>([])
  useEffect(() => {
    loadFilenames('config').then(files => setFileList(files))
  })
  function loadLocalCdspConfig(files: FileList): void {
    importedYamlConfigAsJson(files).then(setImportConfig)
  }
  function loadLocalEqApoConfig(files: FileList): void {
    importedEqApoConfigAsJson(files).then(setImportConfig)
  }
  function loadJsonConfigWithName(name: string): void {
    loadConfigJson(name).then(setImportConfig)
  }
  return <div className="wide-tabpanel">
    <div className="horizontally-spaced-content">
      <UploadButton text="Import CamillaDSP Config" upload={loadLocalCdspConfig}/>
      <UploadButton text="Import Equalizer APO Config" upload={loadLocalEqApoConfig}/>
    </div>
    <p>
      {fileList.map(file =>
          <>
            <Button style={{marginBottom:'5px'}} key={file} text={file} onClick={() => loadJsonConfigWithName(file)}/>
            <br/>
          </>
      )}
    </p>
  </div>
}

function ConfigItemSelection(props: {
  config: ImportedConfig
  import: (importConfig: ImportedConfig) => void
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