import * as React from "react"
import {VolumeBox} from "./sidepanel/volumebox"
import {Box, Button, MdiButton, MdiIcon} from "./utilities/ui-components"
import {mdiHelpCircleOutline, mdiImageSizeSelectSmall} from "@mdi/js"
import {Config, filterGain, setFilterGain} from "./camilladsp/config"
import {defaultStatus} from "./camilladsp/status"
import {Update} from "./utilities/common"
import {useEffect, useState} from "react"
import {loadConfigJson, loadFiles} from "./files"

export function isCompactViewEnabled(): boolean {
  return new URLSearchParams(window.location.search).has("compactview")
}

export function setCompactViewEnabled(enabled: boolean) {
  window.history.pushState(
      undefined,
      'CamillaDSP',
      enabled ? "/?compactview" : "/"
  )
}

const BASS = "Bass"
const TREBLE = "Treble"

export function CompactView(props: {
  currentConfigName?: string
  config: Config
  updateConfig: (update: Update<Config>) => void
  setConfig: (name: string, config: Config) => void
  disableCompactView: () => void
}) {
  const {currentConfigName, config, setConfig, updateConfig, disableCompactView} = props
  return <div className="tabpanel" style={{margin: 'auto'}}>
    <DisableCompactViewButton disableCompactView={disableCompactView}/>
    <VolumeBox vuMeterStatus={defaultStatus()} setMessage={() => {}}/>
    <BassAndTreble config={config} updateConfig={updateConfig}/>
    <QuickConfigSwitch setConfig={setConfig} currentConfigName={currentConfigName}/>
  </div>
}

function DisableCompactViewButton(props: {disableCompactView: () => void}) {
  return <div onClick={props.disableCompactView}>
    <MdiButton
        icon={mdiImageSizeSelectSmall}
        tooltip="Change to normal view"
    />
  </div>
}

function BassAndTreble(props: {
  config: Config,
  updateConfig: (update: Update<Config>) => void
}) {
  const {config, updateConfig} = props
  const bass = filterGain(config, BASS)
  const treble = filterGain(config, TREBLE)
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
        <EqSlider value={bass} setValue={value => updateConfig(cfg => setFilterGain(cfg, BASS, value))}/>
      </div>
      <div>
        {TREBLE} <span className="db-label">{treble}</span> dB
        <EqSlider value={treble} setValue={value => updateConfig(cfg => setFilterGain(cfg, TREBLE, value))}/>
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

function QuickConfigSwitch(props:{
  currentConfigName?: string
  setConfig: (name: string, config: Config) => void
}) {
  const {currentConfigName, setConfig} = props
  const [configFiles, setConfigFiles] = useState<string[]>([])
  useEffect(() => {
    loadFiles("config").then(files => setConfigFiles(files))
  }, [])
  return <Box title="Quick Config Switch">
    <div className="quick-config-switch">
      {configFiles.map(configFile =>
          <Button
              key={configFile}
              text={configFile}
              onClick={() => {
                loadConfigJson(configFile)
                    .then(response => response.json())
                    .then(json => setConfig(configFile, json as Config))
              }}
              className={configFile === currentConfigName ? "highlighted-button" : ''}/>
      )}
    </div>
  </Box>
}