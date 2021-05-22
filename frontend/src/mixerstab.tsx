import React from "react"
import "./index.css"
import {
  AddButton,
  Box,
  DeleteButton,
  ErrorMessage,
  IntOption,
  MdiButton,
  modifiedCopyOf,
  ParsedInput,
  Update
} from "./utilities/common-tsx"
import {
  Config,
  defaultMapping,
  defaultMixer,
  defaultSource,
  Mapping,
  Mixer,
  mixerNamesOf,
  Mixers,
  newMixerName,
  removeMixer,
  renameMixer,
  Source
} from "./config"
import {mdiPlusMinusVariant, mdiVolumeOff} from "@mdi/js"
import {ErrorsForPath, errorsForSubpath} from "./utilities/errors"

export class MixersTab extends React.Component<{
  mixers: Mixers
  errors: ErrorsForPath
  updateConfig: (update: Update<Config>) => void
}, {
  mixerKeys: { [name: string]: number}
}> {
  constructor(props: any) {
    super(props)
    this.mixerNames = this.mixerNames.bind(this)
    this.addMixer = this.addMixer.bind(this)
    this.renameMixer = this.renameMixer.bind(this)
    this.removeMixer = this.removeMixer.bind(this)
    this.isFreeMixerName = this.isFreeMixerName.bind(this)
    this.state = {
      mixerKeys: {}
    }
    this.mixerNames().forEach((name, i) => this.state.mixerKeys[name] = i)
  }

  private mixerNames(): string[] {
    return mixerNamesOf(this.props.mixers)
  }

  private addMixer() {
    this.props.updateConfig(config => {
      const newMixer = newMixerName(config.mixers)
      this.setState(oldState =>
          modifiedCopyOf(oldState, newState =>
              newState.mixerKeys[newMixer] = 1 + Math.max(0, ...Object.values(oldState.mixerKeys))
          )
      )
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
    const {mixers, errors, updateConfig} = this.props
    return (
        <div className="tabpanel">
          <ErrorMessage message={errors({path: []})}/>
          {this.mixerNames()
              .map(name =>
                  <MixerView
                      key={this.state.mixerKeys[name]}
                      name={name}
                      mixer={mixers[name]}
                      errors={errorsForSubpath(errors, name)}
                      update={updateMixer => updateConfig(config => updateMixer(config.mixers[name]))}
                      isFreeMixerName={this.isFreeMixerName}
                      rename={newName => this.renameMixer(name, newName)}
                      remove={() => this.removeMixer(name)}
                  />
              )
          }
          <div>
            <AddButton tooltip="Add a new mixer" onClick={this.addMixer}/>
          </div>
        </div>
    )
  }
}

function MixerView(props: {
  name: string
  mixer: Mixer
  errors: ErrorsForPath
  isFreeMixerName: (name: string) => boolean
  rename: (newName: string) => void
  remove: () => void
  update: (update: Update<Mixer>) => void
}) {
  const {name, mixer, errors, rename, remove, update} = props
  const isValidMixerName = (newName: string) =>
      name === newName || (newName.trim().length > 0 && props.isFreeMixerName(newName))
  return <Box title={
    <>
      <ParsedInput
          value={name}
          style={{width: '300px'}}
          data-tip="Mixer name, must be unique"
          onChange={rename}
          asString={name => name}
          parseValue={name => isValidMixerName(name) ? name : undefined}
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
          data-tip="Number of channels in"
          small={true}
          withControls={true}
          min={1}
          onChange={channelsIn => update(mixer => mixer.channels.in = channelsIn)}/>
      <IntOption
          value={mixer.channels.out}
          desc="out"
          data-tip="Number of channels out"
          small={true}
          withControls={true}
          min={1}
          onChange={channelsOut => update(mixer => mixer.channels.out = channelsOut)}/>
    </div>
    <ErrorMessage message={errors({path: ['channels']})}/>
    <ErrorMessage message={errors({path: ['channels', 'in']})}/>
    <ErrorMessage message={errors({path: ['channels', 'out']})}/>
    {mixer.mapping.map((mapping, index) =>
        <MappingView
            key={index}
            mapping={mapping}
            errors={errorsForSubpath(errors, 'mapping', index)}
            channels={mixer.channels}
            update={mappingUpdate => update(mixer => mappingUpdate(mixer.mapping[index]))}
            remove={() => update(mixer => mixer.mapping.splice(index, 1))}/>
    )}
    <div>
      {mixer.mapping.length < mixer.channels.out &&
        <AddButton
            tooltip="Add a mapping"
            style={{marginTop: '10px'}}
            onClick={() => update(mixer => mixer.mapping.push(defaultMapping(mixer.channels.out, mixer.mapping)))}/>
      }
    </div>
  </Box>
}

function MappingView(props: {
  mapping: Mapping
  errors: ErrorsForPath
  channels: { in: number, out: number }
  remove: () => void
  update: (update: Update<Mapping>) => void
}) {
  const {mapping, errors, channels, remove, update} = props
  return <Box style={{marginTop: '5px'}} title={
    <>
      <IntOption
          value={mapping.dest}
          desc="dest"
          data-tip="Destination channel"
          small={true}
          withControls={true}
          min={0}
          max={channels.out-1}
          onChange={dest => update(mapping => mapping.dest = dest)}/>
      <MdiButton
          icon={mdiVolumeOff}
          tooltip={"Mute destination channel"}
          smallButton={true}
          className={mapping.mute ? "highlighted-button" : ""}
          onClick={() => update(mapping => mapping.mute = !mapping.mute)}/>
      <DeleteButton
          tooltip="Delete this mapping"
          smallButton={true}
          onClick={remove}/>
    </>
  }>
    <ErrorMessage message={errors({path: ['dest']})}/>
    <ErrorMessage message={errors({path: ['mute']})}/>
    <ErrorMessage message={errors({path: []})}/>
    <ErrorMessage message={errors({path: ['sources']})}/>
    <div style={{display: 'flex', flexDirection: 'column'}}>
      {mapping.sources.map((source, index) =>
          <React.Fragment key={index}>
            <SourceView
                source={source}
                errors={errorsForSubpath(errors, 'sources', index)}
                channelsIn={channels.in}
                update={updateSource => update(mixer => updateSource(mixer.sources[index]))}
                remove={() => update(mixer => mixer.sources.splice(index, 1))}/>
            {index+1 < mapping.sources.length && <hr/>}
          </React.Fragment>
      )}
      <div>
        <AddButton
            tooltip="Add a source to this mapping"
            onClick={() => update(mapping => mapping.sources.push(defaultSource(channels.in, mapping.sources)))}/>
      </div>
    </div>
  </Box>
}

function SourceView(props: {
  source: Source
  errors: ErrorsForPath
  channelsIn: number
  update: (update: Update<Source>) => void
  remove: () => void
}) {
  const {source, errors, channelsIn, update, remove} = props
  return <>
    <div className="horizontally-spaced-content">
      <div style={{flexGrow: 1}}>
        <IntOption
            value={source.channel}
            desc="channel"
            data-tip="Channel number"
            small={true}
            withControls={true}
            min={0}
            max={channelsIn - 1}
            onChange={channel => update(source => source.channel = channel)}/>
      </div>
      <div style={{flexGrow: 1}}>
        <IntOption
            value={source.gain}
            desc="gain"
            data-tip="Gain in dB"
            small={true}
            onChange={gain => update(source => source.gain = gain)}/>
      </div>
      <MdiButton
          icon={mdiPlusMinusVariant}
          tooltip={"Invert source channel"}
          smallButton={true}
          className={source.inverted ? "highlighted-button" : ""}
          onClick={() => update(source => source.inverted = !source.inverted)}/>
      <MdiButton
          icon={mdiVolumeOff}
          tooltip={"Mute source channel"}
          smallButton={true}
          className={source.mute ? "highlighted-button" : ""}
          onClick={() => update(source => source.mute = !source.mute)}/>
      <DeleteButton tooltip="Delete this source" smallButton={true} onClick={remove}/>
    </div>
    <ErrorMessage message={errors({path: [], includeChildren: true})}/>
  </>
}