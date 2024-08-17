import * as React from "react"
import {useEffect, useState} from "react"
import {Box, Button, MdiIcon} from "./utilities/ui-components"
import {mdiHelpCircleOutline, mdiAlert} from "@mdi/js"
import {loadConfigJson, loadFilenames} from "./utilities/files"
import {Config} from "./camilladsp/config"
import {numberValues, setNumberValues, Update, boolValues, setBoolValues} from "./utilities/common"
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
      // TODO warn when different parameters are out of sync?
      // TODO reset button, where to get original values?
      const desc = s.description ? s.description + "<br><br>" : ""
      let shortcut_desc = desc + "Controlled config elements:<br>"
      for (const elem of s.config_elements) {
        const path = elem.path.join("/")
        const reverse = elem.reverse ? "<i>reverse</i>" : ""

        shortcut_desc = shortcut_desc + path + " " + reverse + "<br>"
      }
      if (s.type && s.type === "boolean") {
        let values = boolValues(config, s)
        return <div key={s.name}>
          <div className='horizontally-spaced-content'>
            <div>{s.name}</div>
            {<DescriptionIcon description={shortcut_desc}/>}{<AlertIcon values={values}/>}
            <div>:</div>
            <Checkbox
              value={values[0]}
              setValue={v => updateConfig(cfg => setBoolValues(cfg, s, v))}
            />
          </div>
        </div>
      } else {
        let values = numberValues(config, s)
        return <div key={s.name}>
          <div className='horizontally-spaced-content'>
            <div>{s.name}</div>
            {<DescriptionIcon description={shortcut_desc}/>}{<AlertIcon values={values}/>}
            <div>:</div>
            <div>{values[0]}</div>
            <br/>
          </div>
          <Slider
            value={values[0]}
            setValue={v => updateConfig(cfg => setNumberValues(cfg, s, v))}
            min={s.range_from!}
            max={s.range_to!}
            step={s.step!}
          />
        </div>
      }
    })}
  </Box>
}

function DescriptionIcon(props: {description?: string}) {
  const {description} = props
  return description === undefined ?
      null :
      <MdiIcon icon={mdiHelpCircleOutline} tooltip={description.replace(/\n/gi, '<br>')}/>
}

function AlertIcon(props: {values: (boolean|number|undefined)[]}) {
  const {values} = props
  const missing = values.includes(undefined)
  const not_synced = !values.every(val => val === values[0])
  let description = ""
  if (missing) {
    description = description + "One or several config elements are missing."
  }
  if (not_synced) {
    if (description) {
      description = description + "<br><br>"
    }
    description = description + "This shortcut controls multiple elements, that are not in sync.<br>Changing this control may lead to unexpected results."
  }
  return description ?
      <MdiIcon icon={mdiAlert} tooltip={description}/> : null
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

function Checkbox(props: {
  value?: boolean
  setValue: (value: boolean) => void
}) {
  const value = props.value ?? false
  const disabled = props.value === undefined
  return <input
      disabled={disabled}
      style={{margin: 0, padding: 0}}
      type="checkbox"
      checked={value}
      onChange={e => props.setValue(e.target.checked)}
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