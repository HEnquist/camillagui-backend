import React, { ReactNode, useEffect, useState } from "react"
import { Box, Button, CheckBox, CloseButton, MdiIcon, UploadButton } from "../utilities/ui-components"
import { loadMigratedConfigJson, loadFilenames } from "../utilities/files"
import { Config } from "../camilladsp/config"
import { isObject } from "lodash"
import { asFormattedText, isComplexObject, Update, withoutEmptyProperties } from "../utilities/common"
import {
  Import,
  ImportedConfig,
  importedConvolverConfigAsJson,
  importedEqAPOConfigAsJson,
  importedYamlConfigAsJson,
  mergeTopLevelObjectsAndAppendTopLevelArrays,
  topLevelComparator
} from "./configimport"
import { mdiAlert, mdiInformation } from "@mdi/js"
import { bottomMargin } from "../utilities/styles"
import { Tooltip } from 'react-tooltip'
import Popup from "reactjs-popup"

export type ImportPopupProps = {} | {
  currentConfig: Config
  updateConfig: (update: Update<Config>) => void
  close: () => void
}

export class ImportPopup extends React.Component<
  ImportPopupProps,
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
    this.state = {}
  }

  private setImportConfig(name: string, config: ImportedConfig) {
    this.setState({ importDoneFromFile: undefined, importConfig: { name, config } })
  }

  private close() {
    if ('close' in this.props)
      this.props.close()
    this.setState({ importDoneFromFile: undefined, importConfig: undefined })
  }

  render() {
    if (!('close' in this.props))
      return null
    const { currentConfig, updateConfig } = this.props
    const { importDoneFromFile, importConfig } = this.state
    return <Popup open={true}
      onClose={() => this.close()}
      closeOnDocumentClick={true}
      contentStyle={{ width: 'max-content' }} >
      <CloseButton onClick={() => this.close()} />
      <div style={{ height: '90vh', overflowY: 'auto' }}>
        {importConfig ?
          <ConfigItemSelection
            currentConfig={currentConfig}
            configName={importConfig.name}
            config={importConfig.config}
            import={configToImport => {
              updateConfig(config => mergeTopLevelObjectsAndAppendTopLevelArrays(config, configToImport))
              this.setState({ importDoneFromFile: importConfig?.name, importConfig: undefined })
            }}
            cancel={() => this.close()}
          />
          : <FileList
            importDoneFromFile={importDoneFromFile}
            setImportConfig={this.setImportConfig} />}
      </div>
    </Popup>
  }

}

function FileList(props: {
  importDoneFromFile?: string
  setImportConfig: (name: string, config: ImportedConfig) => void
}) {
  const { importDoneFromFile, setImportConfig } = props
  const [fileList, setFileList] = useState<string[]>([])
  useEffect(() => {
    loadFilenames('config').then(files => setFileList(files))
  }, [])
  function loadLocalCdspConfig(files: FileList): void {
    const file = files[0]
    importedYamlConfigAsJson(files).then(config => setImportConfig(file.name, config))
  }
  function loadLocalConvolverConfig(files: FileList) {
    const file = files[0]
    importedConvolverConfigAsJson(files).then(config => setImportConfig(file.name, config))
  }
  function loadLocalEqAPOConfig(files: FileList) {
    const file = files[0]
    importedEqAPOConfigAsJson(files, 2).then(config => setImportConfig(file.name, config))
  }
  function loadJsonConfigWithName(name: string): void {
    loadMigratedConfigJson(name).then(config => setImportConfig(name, config))
  }
  return <div className="tabpanel">
    {importDoneFromFile ?
      <div style={bottomMargin}>
        Import from {importDoneFromFile} was successful.<br />
        <br />
        Close this dialog or select another file to import.
      </div>
      : <div style={bottomMargin}>Select from which file to import.</div>
    }
    <Box title="Upload new config file">
      <div style={{
        display: 'grid',
        alignItems: 'center',
        gridTemplateColumns: '32% 32% 32%',
        columnGap: '2%'
      }}>
        <UploadButton text="CamillaDSP Config" tooltip="Import selected parts from a<br>CamillaDSP config file.<br>Configs for CamillaDSP<br>v1 and v2 are supported." upload={loadLocalCdspConfig} />
        <UploadButton text="Convolver Config" tooltip="Translate a 'Convolver' config file<br>and import selected parts." upload={loadLocalConvolverConfig} />
        <UploadButton text="EqAPO Config" tooltip="Translate an 'Equalizer APO' config file<br>and import selected parts." upload={loadLocalEqAPOConfig} />
      </div>
    </Box>
    <Box title="Existing config file">
      {fileList.map(file =>
        <div key={file}>
          <Button style={{ marginBottom: '5px' }} text={file} onClick={() => loadJsonConfigWithName(file)} />
          <br />
        </div>
      )}
    </Box>
  </div>
}

function ConfigItemSelection(props: {
  currentConfig: Config
  configName: string
  config: ImportedConfig
  import: (importConfig: ImportedConfig) => void
  cancel: () => void
}) {
  useEffect(() => {}, []) //Tooltip.rebuild() })
  const { currentConfig } = props
  const config = props.config as any
  const [configImport, setConfigImport] = useState<Import>(new Import(config))
  const topLevelConfigElements = Object.keys(withoutEmptyProperties(config)).sort(topLevelComparator)
  return <>
    <div style={bottomMargin}>Select what to import</div>
    <div style={bottomMargin}>
      {<>
        <CheckBox
          text={props.configName}
          checked={configImport.isWholeConfigImported()}
          onChange={checked => setConfigImport(new Import(config, checked ? config : {}))} />
        <br />
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
            style={{ marginLeft: margin(1) }}
          />
          {valueAppended(config[parentKey])}
          <br />
          {isComplexObject(subElement)
            && Object.entries(subElement)
                  .filter(([key, subValue]) => subValue !== null)
                  .map(([key, subValue]) => {
              return <div key={key} style={{ marginLeft: margin(2) }}>
                <CheckBox text={key}
                  editable={configImport.isSecondLevelElementEditable(parentKey, key)}
                  checked={configImport.isSecondLevelElementImported(parentKey, key)}
                  onChange={checked =>
                    setConfigImport(prev => prev.toggleSecondLevelElement(parentKey, key, checked ? 'import' : 'remove'))
                  }
                />
                {valueAppended(subValue, `${parentKey}-${key}`)}
                {collisionWarning(currentConfig, parentKey, key)}
                <br />
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
        onClick={() => props.import(configImport.configToImport)} />
      <Button text="Cancel"
        onClick={props.cancel} />
    </div>
  </>
}

function valueAppended(value: any, tooltipId?: string): ReactNode {
  if (!isComplexObject(value))
    return <span style={{ color: 'var(--disabled-text-color)' }}>: {value.toString()}</span>
  if (isComplexObject(value) && tooltipId) {
    return <span data-tooltip-html={""} data-tooltip-id={tooltipId}>
      <MdiIcon icon={mdiInformation} />
      <Tooltip id={tooltipId} className="import-tab-tooltip">
        <pre>{asFormattedText(value, 20)}</pre>
      </Tooltip>
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
    && config[parentKey] !== null
    && valueKey in config[parentKey]
  ) {
    const value = config[parentKey][valueKey]
    const tooltipId = `${parentKey}-${valueKey}-warning`
    if (isObject(value))
      return <span data-tooltip-html={""} data-tooltip-id={tooltipId}>
        <MdiIcon
          icon={mdiAlert}
          style={{ color: 'var(--error-text-color)' }} />
        <Tooltip id={tooltipId} className="tooltip">
          {`${valueKey} is already present in the current config and will be overridden, when this item is imported`}
        </Tooltip>
      </span>
  }
  return null
}