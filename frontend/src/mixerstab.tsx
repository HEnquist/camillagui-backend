import React, {useState} from "react"
import Icon from "@mdi/react"
import "./index.css"
import {
  AddButton,
  Box,
  CloseButton,
  DeleteButton,
  ErrorMessage,
  IntOption,
  LabelListOption,
  MdiButton,
  ParsedInput,
  OptionalTextInput,
  OptionalTextOption,
  EnumInput,
  null_to_default,
  FloatInput,
  MatrixCell
} from "./utilities/ui-components"
import {
  Config,
  defaultMapping,
  defaultMixer,
  Mapping,
  Mixer,
  mixerNamesOf,
  newMixerName,
  removeMixer,
  renameMixer,
  Source,
  GainScales,
  GainScale,
  getMixerInputLabels,
  getLabelForChannel,
  getLabelForChannel2,
} from "./camilladsp/config"
import {mdiDelete, mdiPlusMinusVariant, mdiVolumeOff, mdiPlus} from "@mdi/js"
import {ErrorsForPath, errorsForSubpath} from "./utilities/errors"
import {modifiedCopyOf, Update} from "./utilities/common"
import { Range } from "immutable"

export class MixersTab extends React.Component<{
  config: Config
  errors: ErrorsForPath
  updateConfig: (update: Update<Config>) => void
}, {
  mixerKeys: { [name: string]: number}
}> {
  constructor(props: any) {
    super(props)
    this.mixerNames = this.mixerNames.bind(this)
    this.addMixer = this.addMixer.bind(this)
    this.updateMixer = this.updateMixer.bind(this)
    this.renameMixer = this.renameMixer.bind(this)
    this.removeMixer = this.removeMixer.bind(this)
    this.isFreeMixerName = this.isFreeMixerName.bind(this)
    this.state = {
      mixerKeys: {}
    }
    this.mixerNames().forEach((name, i) => this.state.mixerKeys[name] = i)
  }

  private mixerNames(): string[] {
    return mixerNamesOf(this.props.config.mixers)
  }

  private updateMixer(name: string, update: Update<Mixer>) {
    this.props.updateConfig(config => {
      if (!config.mixers) {
        config.mixers = {}
      }
      update(config.mixers[name])
    })
  }

  private addMixer() {
    this.props.updateConfig(config => {
      const newMixer = newMixerName(config.mixers)
      this.setState(oldState =>
          modifiedCopyOf(oldState, newState =>
              newState.mixerKeys[newMixer] = 1 + Math.max(0, ...Object.values(oldState.mixerKeys))
          )
      )
      if (config.mixers === null) {
        config.mixers = {}
      }
      config.mixers[newMixer] = defaultMixer()
    })
  }

  private removeMixer(name: string) {
    this.props.updateConfig(config => {
      removeMixer(config, name)
      this.setState(oldState =>
          modifiedCopyOf(oldState, newState => delete newState.mixerKeys[name])
      )
    })
  }

  private renameMixer(oldName: string, newName: string) {
    if (this.isFreeMixerName(newName))
      this.props.updateConfig(config => {
        this.setState(oldState =>
            modifiedCopyOf(oldState, newState => {
              newState.mixerKeys[newName] = newState.mixerKeys[oldName]
              delete newState.mixerKeys[oldName]
            }))
        renameMixer(config, oldName, newName)
      })
  }

  private isFreeMixerName(name: string) {
    return !this.mixerNames().includes(name)
  }

  render() {
    const {config, errors} = this.props
    const mixers = config.mixers ? config.mixers : {}
    return (
      <div className="tabcontainer"><div className="tabpanel" style={{width: '700px'}}>
          <ErrorMessage message={errors({path: []})}/>
          {this.mixerNames()
              .map(name =>
                  <MixerView
                      key={this.state.mixerKeys[name]}
                      name={name}
                      mixer={mixers[name]}
                      config={config}
                      errors={errorsForSubpath(errors, name)}
                      update={update => this.updateMixer(name, update)}
                      isFreeMixerName={this.isFreeMixerName}
                      rename={newName => this.renameMixer(name, newName)}
                      remove={() => this.removeMixer(name)}
                  />
              )
          }
          <div>
            <AddButton tooltip="Add a new mixer" onClick={this.addMixer}/>
          </div>
        </div><div className="tabspacer"></div></div>
    )
  }
}

function MixerView(props: {
  name: string
  mixer: Mixer
  config: Config
  errors: ErrorsForPath
  isFreeMixerName: (name: string) => boolean
  rename: (newName: string) => void
  remove: () => void
  update: (update: Update<Mixer>) => void
}) {
  const {name, mixer, config, errors, rename, remove, update} = props
  let [expanded, setExpanded] = useState(false)
  const isValidMixerName = (newName: string) =>
      name === newName || (newName.trim().length > 0 && props.isFreeMixerName(newName))
  const input_labels = getMixerInputLabels(config, name)

  const toggleExpanded = () => {
    setExpanded(!expanded)
  }

  const updateChannelLabel = (channel: number, label: string | null) => {
    let existing = props.mixer.labels
    if (existing === null) {
      existing = []
    }
    while (existing.length <= channel) {
      existing.push(null)
    }
    existing[channel] = label
    console.log("Update label for channel", channel, label)
    update(mixer =>
      mixer.labels = existing)
  }

  const updateChannelLabels = (labels: (string | null)[] | null) => {
    if (labels !== null && labels.length > props.mixer.channels.out) {
      labels = labels.slice(0, props.mixer.channels.out)
    }
    console.log("Update labels to", labels)
    update(mixer =>
      mixer.labels = labels)
  }

  const makeDropdown = () =>
  {
    return <div>
      {Range(0, 2).map(row => (
                <OptionalTextOption value={mixer.labels && mixer.labels.length > row ? mixer.labels[row] : null } 
                error={errors({path: ['labels']})}
                desc={row.toString()}
                tooltip={'Label for channel '+ row}
                onChange={new_label => updateChannelLabel(row, new_label)}/>
            ))}
    </div>
}

  return <Box title={
    <>
      <ParsedInput
          value={name}
          style={{width: '300px'}}
          tooltip="Mixer name, must be unique"
          onChange={rename}
          asString={name => name}
          parseValue={name => isValidMixerName(name) ? name : undefined}
          immediate={false}
      />
      <DeleteButton
          tooltip="Delete this mixer"
          smallButton={true}
          onClick={remove}/>
    </>
  }>
    <ErrorMessage message={errors({path: []})}/>
    <div style={{display: 'flex', justifyContent: 'space-evenly'}}>
      <IntOption
          value={mixer.channels.in}
          desc="in"
          tooltip="Number of channels in (source channels)"
          small={true}
          withControls={true}
          min={1}
          onChange={channelsIn => update(mixer => mixer.channels.in = channelsIn)}/>
      <IntOption
          value={mixer.channels.out}
          desc="out"
          tooltip="Number of channels out (destination channels)"
          small={true}
          withControls={true}
          min={1}
          onChange={channelsOut => update(mixer => mixer.channels.out = channelsOut)}/>
    </div>
    <ErrorMessage message={errors({path: ['channels']})}/>
    <ErrorMessage message={errors({path: ['channels', 'in']})}/>
    <ErrorMessage message={errors({path: ['channels', 'out']})}/>
    <MappingMatrix
            mixer={mixer}
            errors={errorsForSubpath(errors, 'mapping', 0)}
            channels={mixer.channels}
            update={mixerUpdate => update(mixer => mixerUpdate(mixer))}
            remove={() => update(mixer => mixer.mapping.splice(0, 1))}
            updateLabel={updateChannelLabel}
            inputLabels={input_labels}/>
    <div className="vertically-spaced-content">
      <OptionalTextInput
        placeholder="description"
        value={mixer.description}
        tooltip="Mixer description"
        onChange={desc => update(mixer => mixer.description = desc)}/>
      <LabelListOption
        value={mixer.labels ? mixer.labels.map(lab => lab ? lab : "").join(",") : ""}
        error={errors({path: ['labels']})}
        desc="labels"
        onChange={updateChannelLabels}
        onButtonClick={toggleExpanded}
      />
      {expanded && makeDropdown()}
    </div>
  </Box>
}


function getMapping(mappings: Mapping[], dest: number): [Mapping|undefined, number] {
  const idx = mappings.findIndex(m => m.dest === dest)
  if (idx >= 0) {
    return [mappings[idx], idx]
  }
  return [undefined, idx]
}

function getSource(mappings: Mapping[], src: number, dest: number): [Source | undefined, number, number] {
  const [mapping, map_idx] = getMapping(mappings, dest)
  if (mapping === undefined) {
    return [undefined, map_idx, -1]
  }
  const idx = mapping.sources.findIndex(s => s.channel === src)
  if (idx >= 0) {
    return [mapping.sources[idx], map_idx, idx]
  }
  return [undefined, map_idx, idx]
}

function addCell(mixer: Mixer, source: number, dest: number) {
  let [mapping, idx] = getMapping(mixer.mapping, dest)
  if (mapping === undefined) {
    mapping = {
      dest: dest,
      sources: [],
      mute: false
    }
    mixer.mapping.push(mapping)
    idx = mixer.mapping.length - 1
  }
  const cell = { channel: source, gain: 0, inverted: false, mute: false, scale: 'dB' as GainScale }
  mapping.sources.push(cell)
}

function deleteCell(mixer: Mixer, source: number, dest: number) {
  let [cell, map_idx, src_idx] = getSource(mixer.mapping, source, dest)
  if (cell === undefined) {
    return
  }
  mixer.mapping[map_idx].sources.splice(src_idx, 1)
  if (mixer.mapping[map_idx].sources.length === 0) {
    mixer.mapping.splice(map_idx, 1)
  }
}

function updateCell(mixer: Mixer, source: number, dest: number, cell: Source) {
  let [current, map_idx, src_idx] = getSource(mixer.mapping, source, dest)
  if (current === undefined) {
    return
  }
  mixer.mapping[map_idx].sources[src_idx] = cell
}

function MappingMatrix(props: {
  mixer: Mixer
  errors: ErrorsForPath
  channels: { in: number, out: number }
  remove: () => void
  update: (update: Update<Mixer>) => void
  updateLabel: (dest: number, new_label: string|null) => void
  inputLabels: (string | null)[] | null
}) {
  const {mixer, errors, channels, remove, update, updateLabel, inputLabels} = props
  let [expanded, setExpanded] = useState([-1, -1])
  const toggleExpanded = (row: number, col: number) => {
    if (expanded[0] === row && expanded[1] === col) {
      setExpanded([-1, -1])
    }
    else {
      setExpanded([row, col])
    }
  }
  console.log(channels)
  return <div>
    <table className="mixer-table">
      <tr>
        <td colSpan={3} rowSpan={4}></td>
        <td className="matrix-cell" colSpan={channels.in}>Input</td>
      </tr>

      <tr>
        {Range(0, channels.in).map(src => {
          return (<td className="rotate matrix-cell" key={"header"+src}><div>{getLabelForChannel2(inputLabels, src)}</div></td>) })}
      </tr>
      <tr>
        {Range(0, channels.in).map(src => {
          console.log("header", src)
          return (<td className="matrix-cell" key={"header"+src}>{src}</td>) })}
      </tr>
      <tr>
        {Range(0, channels.in).map(src => {
          console.log("header", src)
          return (<td className="matrix-cell" key={"header"+src}>{"\u25bc"}</td>) })}
      </tr>
      
      {Range(0, channels.out).map(dest => {
        let label = null
        if (dest === 0) {
          label = <td className="rotate matrix-cell" rowSpan={channels.out}><div>Output</div></td>
        }
        return (
          <tr key={"row"+dest}>
            {label}
            <td className="matrix-cell" key={"label"+dest}>
              <OptionalTextOption value={mixer.labels && mixer.labels.length > dest ? mixer.labels[dest] : null } 
                error={errors({path: ['labels']})}
                desc={dest.toString()}
                tooltip={'Label for channel '+ dest}
                onChange={new_label => updateLabel(dest, new_label)}/>
            </td>
            <td className="matrix-cell" key={"arrow"+dest}>{"\u25c0"}</td>
            
            {Range(0, channels.in).map(src => {
              const [cell, map_idx, src_idx] = getSource(mixer.mapping, src, dest)
              if (cell) {
                var color
                if (cell.mute) {
                  color = [128, 128, 128]
                }
                else {
                  color = colorAt(cell.gain ? cell.gain: 0)
                }
                var cellText
                if (cell.scale === "linear") {
                  cellText = (+(cell.gain !== null ? cell.gain : 1).toPrecision(2)).toString()
                }
                else {
                  cellText = (Math.round(cell.gain !== null ? cell.gain : 0)).toString()
                }
                if (cell.inverted) {
                  cellText = "\u2195" + cellText
                }
                const csscolor = "rgb(" + Math.round(color[0]) + ", " + Math.round(color[1]) + ", " + Math.round(color[2]) + ")"
                return (<td className="matrix-cell" style={{backgroundColor: csscolor}} key={"cell"+src+"."+dest}><div className='dropdown' style={{ display: 'flex', flexDirection: 'row', alignItems: 'last baseline', height: '100%', minHeight: '100%'}}>
                  <MatrixCell key='expand' muted={cell.mute} text={cellText} onClick={() => {toggleExpanded(dest, src)}} style={{backgroundColor: csscolor}}/>
                  {(expanded[0] === dest && expanded[1]=== src) && makeDropdown(
                    cell, 
                    src,
                    dest,
                    errors,
                    (cellupdate: Update<Source>)=>{update((mixer) => {
                      cellupdate(cell)
                      updateCell(mixer, src, dest, cell)})
                    },
                    ()=>{update((mixer) => {deleteCell(mixer, src, dest)})}
                  )}
                  </div></td>)
              }
              return (<td className="matrix-cell" key={"cell"+src+"."+dest}><AddCell onClick={()=>{
                update((mixer) => {addCell(mixer, src, dest)})}
              }/></td>)
              })}
          </tr>
        )
      })}
    </table>
  </div>
}

const makeDropdown = (cell: Source, src: number, dest: number, errors: ErrorsForPath, update: any, remove: any) => {
  return <div className="dropdown-menu" title='channels' >
      <SourceCell source={cell} errors={errors} update={update} remove={remove}/>
  </div>
}

function SourceCell(props: {
  source: Source
  errors: ErrorsForPath
  update: (update: Update<Source>) => void
  remove: () => void
}) {
  const {source, errors, update, remove} = props
  return <>
    <div className="vertically-spaced-content">

        <div style={{display: 'flex', flexDirection: 'row', flexGrow: 1}}>
          <FloatInput
              value={source.gain ? source.gain : 0.0}
              tooltip="Gain in dB for this source channel"
              className="small-setting-input"
              onChange={(gain: number) => update(source => source.gain = gain)}/>
          <span style={{float: 'right', width: '100%'}}><CloseButton onClick={()=>{}}/></span>
        </div>
        <div style={{flexGrow: 1}}>
          <EnumInput
              value={null_to_default(source.scale, "default")}
              options={GainScales}
              desc=""
              tooltip="Scale for gain"
              onChange={scale => update(source => source.scale = scale )}/>
        </div>

      <div className="horizontally-spaced-content">
        <MdiButton
            icon={mdiPlusMinusVariant}
            tooltip={"Invert this source channel"}
            buttonSize="small"
            highlighted={source.inverted}
            onClick={() => update(source => source.inverted = !source.inverted)}/>
        <MdiButton
            icon={mdiVolumeOff}
            tooltip={"Mute this source channel"}
            buttonSize="small"
            highlighted={source.mute}
            onClick={() => update(source => source.mute = !source.mute)}/>
        <MdiButton
            icon={mdiDelete}
            tooltip={"Delete this cell"}
            buttonSize="small"
            onClick={remove}/>
      </div>
    <ErrorMessage message={errors({path: [], includeChildren: true})}/>
    </div>
  </>
}

function AddCell(props: {
  onClick: () => void
}) {
  const {onClick} = props
  return <div
        data-tooltip-html="Activate this mapping cell"
        data-tooltip-id="main-tooltip"
        className="mapping-cell-empty"
        onClick={props.onClick}>
        <Icon path={mdiPlus} size='16px'/>
  </div>
}

const gaincolors = [[-12, 0, 0, 180], [-9, 0, 0, 255], [-6, 0, 128, 255], [-3, 0, 200, 200], [0, 0, 255, 0], [3, 230, 230, 0], [6, 255, 150, 0], [9, 255, 0, 0], [12, 255, 128, 128]]
function colorAt(index: number): [number, number, number] {
  if (index < -12) {
    index = -12
  }
  if (index > 12) {
    index = 12
  }
  var n = 1
  while (index > gaincolors[n][0]) {
    n += 1
  }
  const prev = gaincolors[n-1]
  const next = gaincolors[n]
  const diff = next[0] - prev[0]
  const frac = (index - prev[0]) / diff
  const nw = frac
  const pw = 1 - nw
  console.log(prev, next, n, diff, pw, nw)
  return [pw * prev[1] + nw * next[1], pw * prev[2] + nw * next[2], pw * prev[3] + nw * next[3]]
}
