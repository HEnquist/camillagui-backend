import React, {ReactNode} from "react"
import "./index.css"
import {PipelinePopup} from './pipelineplotter.js'
import {FLASKURL} from "./index"
import {
  AddButton,
  Box,
  ChartPopup,
  DeleteButton,
  EnumInput,
  EnumOption,
  ERROR_BACKGROUND,
  IntInput,
  MdiButton,
  moveItemDown,
  moveItemUp,
  PlotButton,
  Update
} from "./common-tsx"
import {
  Config,
  defaultFilterStep,
  defaultMixerStep,
  filterNamesOf,
  Filters,
  FilterStep,
  mixerNamesOf,
  Mixers,
  MixerStep,
  Pipeline,
  PipelineStep
} from "./config"
import {mdiArrowDownBold, mdiArrowUpBold} from "@mdi/js"

export class PipelineTab extends React.Component<{
  config: Config
  updateConfig: (update: Update<Config>) => void
}, {
  plotPipeline: boolean
  plotFilterStep: boolean
  data?: any
}> {
  constructor(props: any) {
    super(props)
    this.state = {plotPipeline: false, plotFilterStep: false}
  }

  updatePipeline = (update: Update<Pipeline>) =>
      this.props.updateConfig(config => update(config.pipeline))

  handleStepUpdate = (mixValue: any) =>
      this.updatePipeline(pipeline => pipeline[mixValue.idx] = mixValue.value)

  addStep = () =>
      this.updatePipeline(pipeline => pipeline.push(defaultFilterStep(this.props.config)))

  removeStep = (index: number) =>
      this.updatePipeline(pipeline => pipeline.splice(index, 1))

  updateStep = (index: number, update: Update<PipelineStep>) =>
      this.updatePipeline(pipeline => update(pipeline[index]))

  setStepType = (index: number, type: 'Filter' | 'Mixer') =>
      this.updatePipeline(pipeline => {
        if (type === 'Mixer')
          pipeline[index] = defaultMixerStep(this.props.config)
        else if (type === 'Filter')
          pipeline[index] = defaultFilterStep(this.props.config)
      })

  plotFilterStep = (index: number) => {
    fetch(FLASKURL + "/api/evalfilterstep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({index: index, config: this.props.config}),
    }).then(
        result => result.json()
            .then(data => this.setState({plotFilterStep: true, data: data})),
        error => console.log("Failed", error)
    )
  }

  moveStepUp = (index: number) =>
      this.updatePipeline(pipeline => moveItemUp(pipeline, index))

  moveStepDown = (index: number) =>
      this.updatePipeline(pipeline => moveItemDown(pipeline, index))

  render() {
    const pipeline = this.props.config.pipeline
    return <div className="tabpanel">
      <div className="pipeline-channel">
        Capture: {this.props.config.devices.capture.channels} channels in
      </div>
      {pipeline.map((step: PipelineStep, i: number) => {
            const typeSelect = <EnumInput
                value={step.type}
                options={['Mixer', 'Filter']}
                desc="type"
                data-tip="Step type, Mixer or Filter"
                onChange={type => this.setStepType(i, type)}/>
            const controls = <>
              <DeleteButton tooltip="Delete this step" onClick={() => this.removeStep(i)}/>
              <MdiButton
                  icon={mdiArrowUpBold}
                  tooltip="Move this step up"
                  enabled={i > 0}
                  onClick={() => this.moveStepUp(i)}/>
              <MdiButton
                  icon={mdiArrowDownBold}
                  tooltip="Move this step down"
                  enabled={i+1 < pipeline.length}
                  onClick={() => this.moveStepDown(i)}/>
            </>
            if (step.type === 'Filter')
              return <FilterStepView
                  key={i}
                  typeSelect={typeSelect}
                  filterStep={step}
                  filters={this.props.config.filters}
                  update={update => this.updateStep(i, update as Update<PipelineStep>)}
                  plot={() => this.plotFilterStep(i)}
                  controls={controls}/>
            if (step.type === 'Mixer')
              return <MixerStepView
                  key={i}
                  typeSelect={typeSelect}
                  mixerStep={step}
                  mixers={this.props.config.mixers}
                  update={update => this.updateStep(i, update as Update<PipelineStep>)}
                  controls={controls}/>
            else
              return null
          }
      )}
      <div className="horizontally-spaced-content">
        <AddButton tooltip="Add a pipeline step" onClick={this.addStep}/>
        <PlotButton tooltip="Plot the pipeline" onClick={() => this.setState({plotPipeline: true})}/>
      </div>
      <div className="pipeline-channel">
        Playback: {this.props.config.devices.playback.channels} channels out
      </div>
      <PipelinePopup
          key={this.state.plotPipeline as any}
          open={this.state.plotPipeline}
          config={this.props.config}
          onClose={() => this.setState({plotPipeline: false})}/>
      {this.state.plotFilterStep && <ChartPopup
          key={this.state.plotFilterStep as any}
          open={this.state.plotFilterStep}
          data={this.state.data}
          onClose={() => this.setState({plotFilterStep: false})}/>}
    </div>
  }
}

function MixerStepView(props: {
  typeSelect: ReactNode
  mixerStep: MixerStep
  mixers: Mixers
  update: (update: Update<MixerStep>) => void
  controls: ReactNode
}) {
  const {typeSelect, mixers, mixerStep, update, controls} = props
  const mixer = mixers[mixerStep.name]
  const title = mixer ? `\u00A0\u00A0\u00A0${mixer.channels.in} in, ${mixer.channels.out} out` : ''
  const options = [''].concat(mixerNamesOf(mixers))
  return <Box title={<label>{typeSelect} {title}</label>}>
    <div className="vertically-spaced-content">
      <EnumOption
          value={mixerStep.name}
          options={options}
          desc="name"
          data-tip="Mixer name"
          style={{backgroundColor: mixerStep.name === '' ? ERROR_BACKGROUND : 'initial'}}
          onChange={name => update(step => step.name = name)}/>
      <div className="horizontally-spaced-content">{controls}</div>
    </div>
  </Box>
}

function FilterStepView(props: {
  typeSelect: ReactNode
  filterStep: FilterStep
  filters: Filters
  update: (update: Update<FilterStep>) => void
  plot: () => void
  controls: ReactNode
}) {
  const {typeSelect, filterStep, filters, update, plot, controls} = props
  const options = [''].concat(filterNamesOf(filters))
  const addFilter = () => update(step => step.names.push(options[0]))
  const moveFilterUp = (index: number) => update(step => moveItemUp(step.names, index))
  const moveFilterDown = (index: number) => update(step => moveItemDown(step.names, index))
  return <Box title={typeSelect}>
    <div className="vertically-spaced-content">
      <label data-tip="Channel number">
        channel
        <IntInput
            className="small-setting"
            style={{marginLeft: '5px'}}
            value={filterStep.channel}
            data-tip="Channel number"
            withControls={true}
            min={0}
            onChange={channel => update(step => step.channel = channel)}/>
      </label>
      {filterStep.names.map((name, index) =>
          <div key={index} className="horizontally-spaced-content">
            <EnumInput
                value={name}
                options={options}
                desc=""
                data-tip="Filter name"
                style={{
                  width: '100%',
                  backgroundColor: name === '' ? ERROR_BACKGROUND : 'initial'
                }}
                onChange={filterName => update(step => step.names[index] = filterName)}/>
            <MdiButton
                icon={mdiArrowUpBold}
                tooltip="Move filter up"
                smallButton={true}
                enabled={index > 0}
                onClick={() => moveFilterUp(index)}/>
            <MdiButton
                icon={mdiArrowDownBold}
                tooltip="Move filter down"
                smallButton={true}
                enabled={index + 1 < filterStep.names.length}
                onClick={() => moveFilterDown(index)}/>
            <DeleteButton
                tooltip="Remove this filter from the list"
                smallButton={true}
                onClick={() => update(step => step.names.splice(index, 1))}/>
          </div>
      )}
      <div className="horizontally-spaced-content">
        {controls}
        <AddButton tooltip="Add a filter to the list" onClick={addFilter}/>
        <PlotButton tooltip="Plot response of this step" onClick={plot}/>
      </div>
    </div>
  </Box>
}