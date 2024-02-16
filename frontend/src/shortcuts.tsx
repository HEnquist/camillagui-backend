import * as React from "react"
import {useEffect, useState} from "react"
import {Box, Button, MdiIcon} from "./utilities/ui-components"
import {mdiHelpCircleOutline} from "@mdi/js"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {numberValue, setNumberValue, Update} from "./utilities/common"
import {ShortcutSection} from "./guiconfig"


export function Shortcuts(props: {
    currentConfigName?: string
    config: Config
    updateConfig: (update: Update<Config>) => void
    setConfig: (name: string, config: Config) => void
    shortcutSections: ShortcutSection[]
})
{
    const {currentConfigName, config, setConfig, updateConfig, shortcutSections} = props
    return <div className="tabpanel" style={{margin: 'auto'}}>
        <ShortcutSections sections={shortcutSections} config={config} updateConfig={updateConfig}/>
        <QuickConfigSwitch setConfig={setConfig} currentConfigName={currentConfigName}/>
    </div>
}

export function ShortcutSections(props: {
  sections: ShortcutSection[]
  config: Config
  updateConfig: (update: Update<Config>) => void
}) {
  const {sections, config, updateConfig} = props
  return <>
    {sections.map(section =>
      <ShortcutSectionView key={section.section} section={section} config={config} updateConfig={updateConfig}/>
    )}
  </>
}

function ShortcutSectionView(props: {
  section: ShortcutSection
  config: Config
  updateConfig: (update: Update<Config>) => void
}) {
  const {config, updateConfig, section, section: {shortcuts}} = props
  return <Box title={
    <>
      {section.section}
      {<DescriptionIcon description={section.description}/>}
    </>
  }>
    {shortcuts.map(s => {
      let value = numberValue(config, s.path_in_config)
      return <div key={s.name}>
        <div className='horizontally-spaced-content'>
          <div>{s.name}</div>
          {<DescriptionIcon description={s.description}/>}
          <div>:</div>
          <div>{value}</div>
          <br/>
        </div>
        <Slider
            value={value}
            setValue={v => updateConfig(cfg => setNumberValue(cfg, s.path_in_config, v))}
            min={s.range_from}
            max={s.range_to}
            step={s.step}
        />
      </div>
    })}
  </Box>
}

function DescriptionIcon(props: {description?: string}) {
  const {description} = props
  return description === undefined ?
      null :
      <MdiIcon icon={mdiHelpCircleOutline} tooltip={description}/>
}

function Slider(props: {
  value?: number
  setValue: (value: number) => void
  min: number
  max: number
  step: number
}) {
  const value = props.value ?? 0
  const disabled = props.value === undefined
  return <input
      disabled={disabled}
      style={{width: '100%', margin: 0, padding: 0}}
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={value}
      onChange={e => props.setValue(e.target.valueAsNumber)}
  />
}

export function QuickConfigSwitch(props:{
  currentConfigName?: string
  setConfig: (name: string, config: Config) => void
}) {
  const {currentConfigName, setConfig} = props
  const [configFiles, setConfigFiles] = useState<string[]>([])
  useEffect(() => {
    loadFilenames("config").then(files => setConfigFiles(files))
  }, [])
  return <Box title="Quick Config Switch">
    <div className="quick-config-switch">
      {configFiles.map(configFile =>
          <Button
              key={configFile}
              text={configFile}
              onClick={() => {
                loadConfigJson(configFile)
                    .then(config => setConfig(configFile, config))
              }}
              highlighted={configFile === currentConfigName}/>
      )}
    </div>
  </Box>
}