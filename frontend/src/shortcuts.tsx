import * as React from "react"
import {useEffect, useState} from "react"
import {Box, Button, MdiIcon} from "./utilities/ui-components"
import {mdiHelpCircleOutline} from "@mdi/js"
import {Config, filterParameter, setFilterParameter} from "./camilladsp/config"
import {Update} from "./utilities/common"
import {loadConfigJson, loadFilenames} from "./utilities/files"


export function Shortcuts(props: {
    currentConfigName?: string
    config: Config
    updateConfig: (update: Update<Config>) => void
    setConfig: (name: string, config: Config) => void
})
{
    const {currentConfigName, config, setConfig, updateConfig} = props
    return <div className="tabpanel" style={{margin: 'auto'}}>
        <BassAndTreble config={config} updateConfig={updateConfig}/>
        <QuickConfigSwitch setConfig={setConfig} currentConfigName={currentConfigName}/>
    </div>
}

const BASS = "Bass"
const TREBLE = "Treble"
const BASS_PARAM = "gain"
const TREBLE_PARAM = "gain"

export function BassAndTreble(props: {
  config: Config,
  updateConfig: (update: Update<Config>) => void
}) {
  const {config, updateConfig} = props
  const bass = filterParameter(config, BASS, BASS_PARAM)
  const treble = filterParameter(config, TREBLE, TREBLE_PARAM)
  return <Box title={
    <>
      <div style={{marginRight: '5px'}}>Equalizer</div>
      <MdiIcon icon={mdiHelpCircleOutline} tooltip={
        `To use the EQ, add filters named "${BASS}" and "${TREBLE}" to the pipeline<br>
            Recommented settings:<br>
            ${BASS}: Biquad Lowshelf freq=85 q=0.9<br>
            ${TREBLE}: Biquad Highshelf freq=6500 q=0.7`
      }/>
    </>
  }>
    <div className="two-column-grid">
      <div>
        {BASS} <span className="db-label">{bass}</span> dB
        <EqSlider value={bass} setValue={value => updateConfig(cfg => setFilterParameter(cfg, BASS, BASS_PARAM, value))}/>
      </div>
      <div>
        {TREBLE} <span className="db-label">{treble}</span> dB
        <EqSlider value={treble} setValue={value => updateConfig(cfg => setFilterParameter(cfg, TREBLE, TREBLE_PARAM, value))}/>
      </div>
    </div>
  </Box>
}

function EqSlider(props: {
  value?: number
  setValue: (value: number) => void
}) {
  const value = props.value || 0
  const disabled = props.value === undefined
  return <input
      disabled={disabled}
      style={{width: '100%', margin: 0, padding: 0}}
      type="range"
      min="-6"
      max="6"
      step="0.1"
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