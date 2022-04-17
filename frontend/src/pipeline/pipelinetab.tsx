import React, {ReactNode} from "react"
import "../index.css"
import {PipelinePopup} from './pipelineplotter'
import {
  AddButton,
  Box,
  ChartData,
  ChartPopup,
  DeleteButton,
  EnumInput,
  ERROR_BACKGROUND_STYLE,
  ErrorMessage,
  IntInput,
  MdiButton,
  PlotButton
} from "../utilities/ui-components"
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
} from "../camilladsp/config"
import {mdiArrowDownBold, mdiArrowUpBold} from "@mdi/js"
import {ErrorsForPath, errorsForSubpath} from "../utilities/errors"
import {DndContainer, DndSortable, DragHandle, useDndSort} from "../utilities/dragndrop"
import {moveItem, moveItemDown, moveItemUp} from "../utilities/arrays"
import {Update} from "../utilities/common"


export class PipelineTab extends React.Component<{
  config: Config
  updateConfig: (update: Update<Config>) => void
  errors: ErrorsForPath
}, {
  plotPipeline: boolean
  plotFilterStep: boolean
  stepIndex?: number
  data: ChartData
}> {
  constructor(props: any) {
    super(props)
    this.state = {
      plotPipeline: false,
      plotFilterStep: false,
      data: {
        name: "Pipeline step",
        f: [],
        time: [],
        options: [{name: ""}]
      }
    }
  }

  updatePipeline = (update: Update<Pipeline>) =>
      this.props.updateConfig(config => update(config.pipeline))

  addStep = () =>
      this.updatePipeline(pipeline => pipeline.push(defaultFilterStep(this.props.config)))

  removeStep = (index: number) =>
      this.updatePipeline(pipeline => pipeline.splice(index, 1))

  setStepType = (index: number, type: 'Filter' | 'Mixer') =>
      this.updatePipeline(pipeline => {
        if (type === 'Mixer')
          pipeline[index] = defaultMixerStep(this.props.config)
        else if (type === 'Filter')
          pipeline[index] = defaultFilterStep(this.props.config)
      })

  plotFilterStep = (index: number, samplerate?: number, channels?: number) => {
    const config = this.props.config
    fetch("/api/evalfilterstep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        index: index,
        config: config,
        samplerate: samplerate || config.devices.samplerate,
        channels: channels || config.devices.capture.channels
      }),
    }).then(
        result => result.json()
            .then(data => this.setState({plotFilterStep: true, stepIndex: index, data: data})),
        error => console.log("Failed", error)
    )
  }

  moveStepUp = (index: number) =>
      this.updatePipeline(pipeline => moveItemUp(pipeline, index))

  moveStepDown = (index: number) =>
      this.updatePipeline(pipeline => moveItemDown(pipeline, index))

  render() {
    const errors = this.props.errors
    const pipeline = this.props.config.pipeline
    return <DndContainer>
      <div className="tabpanel">
        <ErrorMessage message={errors({path: []})}/>
        <div className="pipeline-channel">
          Capture: {this.props.config.devices.capture.channels} channels in
        </div>
        {pipeline.map((step: PipelineStep, index: number) => {
              const stepErrors = errorsForSubpath(errors, index)
              const typeSelect = <EnumInput
                  value={step.type}
                  options={['Mixer', 'Filter']}
                  desc="type"
                  data-tip="Step type, Mixer or Filter"
                  onChange={type => this.setStepType(index, type)}/>
              const controls = <>
                <DeleteButton tooltip="Delete this step" onClick={() => this.removeStep(index)}/>
                <MdiButton
                    icon={mdiArrowUpBold}
                    tooltip="Move this step up"
                    enabled={index > 0}
                    onClick={() => this.moveStepUp(index)}/>
                <MdiButton
                    icon={mdiArrowDownBold}
                    tooltip="Move this step down"
                    enabled={index+1 < pipeline.length}
                    onClick={() => this.moveStepDown(index)}/>
              </>
              if (step.type === 'Filter')
                return <FilterStepView
                    key={index}
                    stepIndex={index}
                    typeSelect={typeSelect}
                    filterStep={step}
                    filters={this.props.config.filters}
                    updatePipeline={this.updatePipeline}
                    plot={() => this.plotFilterStep(index)}
                    errors={stepErrors}
                    controls={controls}/>
              if (step.type === 'Mixer')
                return <MixerStepView
                    key={index}
                    stepIndex={index}
                    typeSelect={typeSelect}
                    mixerStep={step}
                    mixers={this.props.config.mixers}
                    updatePipeline={this.updatePipeline}
                    errors={stepErrors}
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
            onChange={name => {
              const current = this.state.data.options.filter(o => o.name === name)[0]
              this.plotFilterStep(this.state.stepIndex!!, current.samplerate, current.channels)
            }}
            onClose={() => this.setState({plotFilterStep: false})}/>}
      </div>
    </DndContainer>
  }
}

function usePipelineStepDndSort(stepIndex: number, updatePipeline: (update: Update<Pipeline>) => void) {
  return useDndSort(
      'step', {stepIndex},
      ({stepIndex: from}, {stepIndex: to}) => updatePipeline(pipeline => moveItem(pipeline, from, to))
  )
}

function MixerStepView(props: {
  stepIndex: number
  typeSelect: ReactNode
  mixerStep: MixerStep
  mixers: Mixers
  updatePipeline: (update: Update<Pipeline>) => void
  errors: ErrorsForPath
  controls: ReactNode
}) {
  const {stepIndex, typeSelect, mixers, mixerStep, updatePipeline, controls} = props
  const update = (update: Update<MixerStep>) => updatePipeline(pipeline => update(pipeline[stepIndex] as MixerStep))
  const mixer = mixers[mixerStep.name]
  const title = mixer ? `${mixer.channels.in} in, ${mixer.channels.out} out` : ''
  const options = [''].concat(mixerNamesOf(mixers))
  const nameError = props.errors({path: ['name']})
  const dndProps = usePipelineStepDndSort(stepIndex, updatePipeline)
  return <DndSortable {...dndProps}>
    <Box title={
      <>
        <DragHandle drag={dndProps.drag} tooltip="Drag mixer to sort"/>
        <label>{typeSelect}&nbsp;&nbsp;&nbsp;&nbsp;{title}</label>
      </>
    }>
      <div className="vertically-spaced-content">
        <ErrorMessage message={props.errors({path: []})}/>
        <ErrorMessage message={props.errors({path: ['type']})}/>
        <EnumInput
            value={mixerStep.name}
            options={options}
            desc="name"
            data-tip="Mixer name"
            style={nameError ? ERROR_BACKGROUND_STYLE : undefined}
            onChange={name => update(step => step.name = name)}/>
        <ErrorMessage message={nameError}/>
        <div className="horizontally-spaced-content">{controls}</div>
      </div>
    </Box>
  </DndSortable>
}

function FilterStepView(props: {
  stepIndex: number
  typeSelect: ReactNode
  filterStep: FilterStep
  filters: Filters
  updatePipeline: (update: Update<Pipeline>) => void
  plot: () => void
  errors: ErrorsForPath
  controls: ReactNode
}) {
  const {stepIndex, typeSelect, filterStep, filters, updatePipeline, plot, controls} = props
  const options = [''].concat(filterNamesOf(filters))
  const update = (update: Update<FilterStep>) => updatePipeline(pipeline => update(pipeline[stepIndex] as FilterStep))
  const addFilter = () => update(step => step.names.push(options[0]))
  const moveFilterUp = (index: number) => update(step => moveItemUp(step.names, index))
  const moveFilterDown = (index: number) => update(step => moveItemDown(step.names, index))
  const moveFilter = (fromStep: number, fromIndex: number, toStep: number, toIndex: number) =>
      update(step => {
            if (fromStep === toStep)
              moveItem(step.names, fromIndex, toIndex)
            else {
              updatePipeline(pipeline => {
                const from = pipeline[fromStep] as FilterStep
                const filter = from.names.splice(fromIndex, 1)
                const to = pipeline[toStep] as FilterStep
                to.names.splice(toIndex, 0, ...filter)
              })
            }
          }
      )
  const dndProps = usePipelineStepDndSort(stepIndex, updatePipeline)
  const title = <>
    <DragHandle drag={dndProps.drag} tooltip="Drag filter step to sort"/>
    {typeSelect}&nbsp;&nbsp;&nbsp;&nbsp;
    <label data-tip="Channel number">
      channel
      <IntInput
          className="small-setting-input"
          style={{marginLeft: '5px'}}
          value={filterStep.channel}
          data-tip="Channel number"
          withControls={true}
          min={0}
          onChange={channel => update(step => step.channel = channel)}/>
    </label>
  </>
  return <DndSortable {...dndProps}>
    <Box title={title}>
      <div className="vertically-spaced-content">
        <ErrorMessage message={props.errors({path: ['type']})}/>
        <ErrorMessage message={props.errors({path: ['channel']})}/>
        <ErrorMessage message={props.errors({path: []})}/>
        <div className="vertically-spaced-content">
          {filterStep.names.map((name, index) =>
              <FilterStepFilter
                  stepIndex={stepIndex}
                  key={index}
                  index={index}
                  name={name}
                  options={options}
                  setName={filterName => update(step => step.names[index] = filterName)}
                  moveFilter={moveFilter}
                  errors={props.errors({path: ['names', index]})}
                  controls={
                    <>
                      <MdiButton
                          icon={mdiArrowUpBold}
                          tooltip="Move filter up"
                          buttonSize="small"
                          enabled={index > 0}
                          onClick={() => moveFilterUp(index)}/>
                      <MdiButton
                          icon={mdiArrowDownBold}
                          tooltip="Move filter down"
                          buttonSize="small"
                          enabled={index + 1 < filterStep.names.length}
                          onClick={() => moveFilterDown(index)}/>
                      <DeleteButton
                          tooltip="Remove this filter from the list"
                          smallButton={true}
                          onClick={() => update(step => step.names.splice(index, 1))}/>
                    </>
                  }
              />
          )}
        </div>
        <ErrorMessage message={props.errors({path: ['names']})}/>
        <div className="horizontally-spaced-content">
          {controls}
          <AddButton tooltip="Add a filter to the list" onClick={addFilter}/>
          <PlotButton tooltip="Plot response of this step" onClick={plot}/>
        </div>
      </div>
    </Box>
  </DndSortable>
}

function FilterStepFilter(props: {
  stepIndex: number
  index: number
  options: string[]
  name: string
  setName: (name: string) => void
  moveFilter: (fromStep: number, fromIndex: number, toStep: number, toIndex: number) => void
  errors?: string
  controls: ReactNode
}) {
  const {stepIndex, index, options, name, setName, moveFilter, errors, controls} = props
  const {isDragging, canDrop, drag, preview, drop} = useDndSort(
      'filter',
      {stepIndex, index},
      ({stepIndex: fromStep, index: fromIndex}, {stepIndex: toStep, index: toIndex}) =>
          moveFilter(fromStep, fromIndex, toStep, toIndex)
  )
  return <DndSortable isDragging={isDragging} canDrop={canDrop} drag={drag} preview={preview} drop={drop}>
    <div className={`horizontally-spaced-content`}>
      <DragHandle drag={drag} tooltip="Drag filter to sort"/>
      <EnumInput
          value={name}
          options={options}
          desc={`step${stepIndex}-filter${index}`}
          data-tip="Filter name"
          style={{
            width: '100%',
            ...(errors ? ERROR_BACKGROUND_STYLE : {})
          }}
          onChange={setName}/>
      {controls}
    </div>
    <ErrorMessage message={errors}/>
  </DndSortable>
}