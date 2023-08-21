import React, {ReactNode, useEffect, useState} from "react"
import {Button, CheckBox, MdiIcon, UploadButton} from "./utilities/ui-components"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {cloneDeep, isArray, isEqual, isObject, merge, pullAt} from "lodash"
import {isComplexObject, modifiedCopyOf, Update, withoutEmptyProperties} from "./utilities/common"
import {
  ImportedConfig,
  importedConvolverConfigAsJson,
  importedEqApoConfigAsJson,
  importedYamlConfigAsJson,
  topLevelComparator
} from "./utilities/configimport"
import {mdiInformation} from "@mdi/js"

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
    <div className="horizontally-spaced-content">
      <UploadButton text="Import CamillaDSP Config" upload={loadLocalCdspConfig}/>
      <UploadButton text="Import Equalizer APO Config" upload={loadLocalEqApoConfig}/>
      <UploadButton text="Import Convolver Config" upload={loadLocalConvolverConfig}/>
    </div>
    <div style={{marginTop: '10px'}}>
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
  const [importConfig, setImportConfig] = useState<ImportedConfig>({})
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
      onChange={checked => setImportConfig(checked ? config : {})}/>
    <br/>
  </>
  const topLevelConfigElements = Object.keys(config).sort(topLevelComparator)
  return <>
    <pre>{JSON.stringify(config, null, 2)}</pre>
    {importConfigCheckBox}
    {topLevelConfigElements.map(key => {
          const subElement = config[key]
          return <ImportTopLevelElementCheckBox
              key={key}
              element={key}
              config={config}
              importConfig={importConfig}
              setImportConfig={setImportConfig}>
            {isComplexObject(subElement)
                && Object.entries(subElement).map(([subKey, subValue]) => {
                  return <div key={subKey} style={{marginLeft: margin(2)}}>
                    <CheckBox text={subKey}
                              tooltip={subKey}
                              checked={key in importConfig && isEqual(config[key][subKey], (importConfig as any)[key][subKey])}
                              onChange={checked => {
                                setImportConfig(prev =>
                                    //TODO select pipeline and then deselecting one item is still broken
                                    modifiedCopyOf(prev, (next: any) => {
                                      if (checked) {
                                        if (!(key in next)) {
                                          if (isArray(config[key]))
                                            next[key] = []
                                          else if (isObject(config[key]))
                                            next[key] = {}
                                        }
                                        next[key][subKey] = cloneDeep(config[key][subKey])
                                      } else {
                                        if (isArray(next[key]))
                                          pullAt(next[key], parseInt(subKey, 10))
                                        else if (isObject(next[key]))
                                          delete next[key][subKey]
                                        if (isEqual(next[key], {}) || isEqual(next[key], []))
                                          delete next[key]
                                      }
                                    }))
                              }}
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
  importConfig: ImportedConfig
  setImportConfig:  React.Dispatch<React.SetStateAction<ImportedConfig>>
  children?: ReactNode
}) {
  const {element, importConfig, children} = props
  const config = props.config as any
  const value = config[element]
  return <>
    <CheckBox
        text={element}
        tooltip={element}
        checked={isEqual(config[element], (importConfig as any)[element]) ? true
            : element in importConfig ? "partially" : false} //TODO does this work properly?
        onChange={checked => {
          props.setImportConfig(prev =>
              modifiedCopyOf(prev, (next: any) => {
                if (checked)
                  next[element] = cloneDeep(config[element])
                else
                  delete next[element]
              }))
        }}
        style={{marginLeft: margin(1)}}
    />
    {valueAppended(value)}
    <br/>
    {children}
  </>
}

function margin(level: number): string {
  return `${level * 10}px`
}