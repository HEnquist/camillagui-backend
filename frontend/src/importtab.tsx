import React, {ReactNode, useEffect, useState} from "react"
import {Button, CheckBox, MdiIcon, UploadButton} from "./utilities/ui-components"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {isObject} from "lodash"
import {asFormattedText, isComplexObject, Update, withoutEmptyProperties} from "./utilities/common"
import {
  Import,
  ImportedConfig,
  importedConvolverConfigAsJson,
  importedEqApoConfigAsJson,
  importedYamlConfigAsJson,
  mergeTopLevelObjectsAndAppendTopLevelArrays,
  topLevelComparator
} from "./utilities/configimport"
import {mdiAlert, mdiInformation} from "@mdi/js"
import {bottomMargin} from "./utilities/styles"
import ReactTooltip from "react-tooltip"

export class ImportTab extends React.Component<
    {
      currentConfig: Config
      updateConfig: (update: Update<Config>) => void
    },
    {
      importDoneFromFile?: string
      importConfig?: {
        name: string
        config: ImportedConfig
      }
    }
> {
  constructor(props: any) {
    super(props)
    this.setImportConfig = this.setImportConfig.bind(this)
    this.state = {importDoneFromFile: undefined}
  }

  private setImportConfig(name: string, config: ImportedConfig) {
    this.setState({importDoneFromFile: undefined, importConfig: {name, config}})
  }

  render() {
    const {currentConfig, updateConfig} = this.props
    const {importDoneFromFile, importConfig} = this.state
    return importConfig ?
        <ConfigItemSelection
            currentConfig={currentConfig}
            configName={importConfig.name}
            config={importConfig.config}
            import={configToImport => {
              updateConfig(config => mergeTopLevelObjectsAndAppendTopLevelArrays(config, configToImport))
              this.setState({importDoneFromFile: importConfig?.name, importConfig: undefined})
            }}
            cancel={() => this.setState({importDoneFromFile: undefined, importConfig: undefined})}
        />
        : <FileList
            importDoneFromFile={importDoneFromFile}
            setImportConfig={this.setImportConfig}/>
  }

}

function FileList(props: {
  importDoneFromFile?: string
  setImportConfig: (name: string, config: ImportedConfig) => void
}) {
  const {importDoneFromFile, setImportConfig} = props
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
    {importDoneFromFile ?
        <div style={bottomMargin}>
          Import from {importDoneFromFile} successful.<br/>
          <br/>
          Would you like to import another file?
        </div>
        : <div style={bottomMargin}>Select from which file to import</div>
    }
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
  currentConfig: Config
  configName: string
  config: ImportedConfig
  import: (importConfig: ImportedConfig) => void
  cancel: () => void
}) {
  useEffect(() => { ReactTooltip.rebuild() })
  const {currentConfig} = props
  const config = withoutEmptyProperties(props.config)
  const [configImport, setConfigImport] = useState<Import>(new Import(config))
  const topLevelConfigElements = Object.keys(config).sort(topLevelComparator)
  return <>
    <div style={bottomMargin}>Select what to import</div>
    <div style={bottomMargin}>
      {<>
        <CheckBox
            text={props.configName}
            checked={configImport.isWholeConfigImported()}
            onChange={checked => setConfigImport(new Import(config, checked ? config : {}))}/>
        <br/>
      </>}
      {topLevelConfigElements.map(parentKey => {
            const subElement = config[parentKey]
            return <div key={parentKey}>
              <CheckBox
                  text={parentKey}
                  checked={configImport.isTopLevelElementImported(parentKey)}
                  onChange={checked =>
                      setConfigImport(prev => prev.toggleTopLevelElement(parentKey, checked ? 'import' : 'remove'))
                  }
                  style={{marginLeft: margin(1)}}
              />
              {valueAppended(config[parentKey])}
              <br/>
              {isComplexObject(subElement)
                  && Object.entries(subElement).map(([key, subValue]) => {
                    return <div key={key} style={{marginLeft: margin(2)}}>
                      <CheckBox text={key}
                                editable={configImport.isSecondLevelElementEditable(parentKey, key)}
                                checked={configImport.isSecondLevelElementImported(parentKey, key)}
                                onChange={checked =>
                                    setConfigImport(prev => prev.toggleSecondLevelElement(parentKey, key, checked ? 'import' : 'remove'))
                                }
                      />
                      {valueAppended(subValue, `${parentKey}-${key}`)}
                      {collisionWarning(currentConfig, parentKey, key)}
                      <br/>
                    </div>
              })
              }
            </div>
          }
      )}
    </div>
    <div className="horizontally-spaced-content">
      <Button text="Import"
              enabled={configImport.isAnythingImported()}
              onClick={() => props.import(configImport.configToImport)}/>
      <Button text="Cancel"
              onClick={props.cancel}/>
    </div>
  </>
}

function valueAppended(value: any, tooltipId?: string): ReactNode {
  if (!isComplexObject(value))
    return <span style={{color: 'var(--disabled-text-color)'}}>: {value.toString()}</span>
  if (isComplexObject(value) && tooltipId) {
    return <span data-tip={true} data-for={tooltipId}>
      <MdiIcon icon={mdiInformation}/>
      <ReactTooltip id={tooltipId} className="import-tab-tooltip" arrowColor="var(--box-border-color)">
        <pre>{asFormattedText(value, 20)}</pre>
      </ReactTooltip>
    </span>
  }
  else
    return null
}

function margin(level: number): string {
  return `${level * 20}px`
}

function collisionWarning(config: any, parentKey: string, valueKey: string): ReactNode {
  if (['filters', 'mixers', 'processors'].includes(parentKey)
      && parentKey in config
      && valueKey in config[parentKey]
  ) {
    const value = config[parentKey][valueKey]
    if (isObject(value))
      return <MdiIcon
          icon={mdiAlert}
          tooltip={`${valueKey} is already present in the current config and will be overridden, when this item is imported`}
          style={{color: 'var(--error-text-color)'}}
      />
  }
  return null
}