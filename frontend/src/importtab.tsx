import React, {ReactNode, useEffect, useState} from "react"
import {Button, CheckBox, MdiIcon, UploadButton} from "./utilities/ui-components"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {isEqual, merge} from "lodash"
import {isComplexObject, Update, withoutEmptyProperties} from "./utilities/common"
import {
  Import,
  ImportedConfig,
  importedConvolverConfigAsJson,
  importedEqApoConfigAsJson,
  importedYamlConfigAsJson,
  topLevelComparator
} from "./utilities/configimport"
import {mdiInformation} from "@mdi/js"
import {bottomMargin} from "./utilities/styles";

export class ImportTab extends React.Component<
    {
      updateConfig: (update: Update<Config>) => void
    },
    {
      importConfig?: {
        name: string
        config: ImportedConfig
      }
    }
> {
  constructor(props: any) {
    super(props)
    this.setImportConfig = this.setImportConfig.bind(this)
    this.state = {}
  }

  private setImportConfig(name: string, config: ImportedConfig) {
    this.setState({importConfig: {name, config}})
  }

  render() {
    const {updateConfig} = this.props
    const {importConfig} = this.state
    return importConfig ?
        <ConfigItemSelection
            configName={importConfig.name}
            config={importConfig.config}
            import={importConfig => updateConfig(config => merge(config, importConfig))}
            cancel={() => this.setState({importConfig: undefined})}
        />
        : <FileList setImportConfig={this.setImportConfig}/>
  }

}

function FileList(props: {
  setImportConfig: (name: string, config: ImportedConfig) => void
}) {
  const {setImportConfig} = props
  const [fileList, setFileList] = useState<string[]>([])
  useEffect(() => {
    loadFilenames('config').then(files => setFileList(files))
  })
  function loadLocalCdspConfig(files: FileList): void {
    importedYamlConfigAsJson(files).then(config => setImportConfig(files[0].name, config))
  }
  function loadLocalEqApoConfig(files: FileList): void {
    importedEqApoConfigAsJson(files).then(config => setImportConfig(files[0].name, config))
  }
  function loadLocalConvolverConfig(files: FileList): void {
    importedConvolverConfigAsJson(files).then(config => setImportConfig(files[0].name, config))
  }
  function loadJsonConfigWithName(name: string): void {
    loadConfigJson(name).then(config => setImportConfig(name, config))
  }
  return <div className="wide-tabpanel">
    <div style={bottomMargin}>Select from which file to import</div>
    <div style={bottomMargin} className="horizontally-spaced-content">
      <UploadButton text="CamillaDSP Config" upload={loadLocalCdspConfig}/>
      <UploadButton text="Equalizer APO Config" upload={loadLocalEqApoConfig}/>
      <UploadButton text="Convolver Config" upload={loadLocalConvolverConfig}/>
    </div>
    <div>
      {fileList.map(file =>
          <div key={file}>
            <Button style={{marginBottom:'5px'}} text={file} onClick={() => loadJsonConfigWithName(file)}/>
            <br/>
          </div>
      )}
    </div>
  </div>
}

function ConfigItemSelection(props: {
  configName: string
  config: ImportedConfig
  import: (importConfig: ImportedConfig) => void
  cancel: () => void
}) {
  const config = withoutEmptyProperties(props.config)
  const [configImport, setConfigImport] = useState<Import>(new Import(config))
  const importConfig = configImport.toImport
  function isWholeConfigImported(): boolean | "partially" {
    if (isEqual(config, importConfig))
      return true
    else if (isEqual(importConfig, {}))
      return false
    else
      return "partially"
  }
  const willAnythingBeImported = Object.keys(importConfig).length > 0
  const importConfigCheckBox = <>
    <CheckBox
      text={props.configName}
      tooltip={props.configName}
      checked={isWholeConfigImported()}
      onChange={checked => setConfigImport(new Import(config, checked ? config : {}))}/>
    <br/>
  </>
  const topLevelConfigElements = Object.keys(config).sort(topLevelComparator)
  return <>
    <pre>{JSON.stringify(config, null, 2)}</pre>
    <div style={bottomMargin}>Select what to import</div>
    {importConfigCheckBox}
    {topLevelConfigElements.map(parentKey => {
          const subElement = config[parentKey]
          return <ImportTopLevelElementCheckBox
              key={parentKey}
              element={parentKey}
              config={config}
              configImport={configImport}
              setConfigImport={setConfigImport}>
            {isComplexObject(subElement)
                && Object.entries(subElement).map(([key, subValue]) => {
                  return <div key={key} style={{marginLeft: margin(2)}}>
                    <CheckBox text={key}
                              tooltip={key}
                              checked={configImport.isSecondLevelElementImported(parentKey, key)}
                              onChange={checked =>
                                  setConfigImport(prev => prev.toggleSecondLevelElement(parentKey, key, checked ? 'import' : 'remove'))
                                    //TODO select pipeline and then deselecting one item is still broken
                              }
                    />
                    {valueAppended(subValue)}
                    <br/>
                  </div>
            })
            }
          </ImportTopLevelElementCheckBox>
        }
    )}
    <div className="horizontally-spaced-content">
      <Button text="Import" enabled={willAnythingBeImported} onClick={() => props.import(importConfig)}/>
      <Button text="Cancel" onClick={props.cancel}/>
    </div>
  </>
}

function valueAppended(value: any): ReactNode | undefined {
  if (isComplexObject(value))
    return <MdiIcon icon={mdiInformation} tooltip={JSON.stringify(value, undefined, 2)}/> //TODO render tooltip properly
  else
    return <span style={{color: 'var(--disabled-text-color)'}}>: {value.toString()}</span>
}

function ImportTopLevelElementCheckBox(props: {
  element: string
  config: ImportedConfig
  configImport: Import
  setConfigImport:  React.Dispatch<React.SetStateAction<Import>>
  children?: ReactNode
}) {
  const {element, config, configImport, children} = props
  return <>
    <CheckBox
        text={element}
        tooltip={element}
        checked={configImport.isTopLevelElementImported(element)}
        onChange={checked =>
          props.setConfigImport(prev => prev.toggleTopLevelElement(element, checked ? 'import' : 'remove'))
        }
        style={{marginLeft: margin(1)}}
    />
    {valueAppended((config as any)[element])}
    <br/>
    {children}
  </>
}

function margin(level: number): string {
  return `${level * 20}px`
}