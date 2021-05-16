import React, {ReactNode} from "react"
import "./index.css"
import {PipelinePopup} from './pipelineplotter'
import {
  AddButton,
  Box,
  ChartPopup,
  DeleteButton,
  EnumInput,
  ErrorMessage,
  FIELD_ERROR_BACKGROUND,
  IntInput,
  MdiButton,
  moveItem,
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
import {mdiArrowDownBold, mdiArrowUpBold, mdiDrag} from "@mdi/js"
import {ErrorsForPath, errorsForSubpath} from "./errors"
import Icon from "@mdi/react"
import {DndProvider, DropTargetMonitor, useDrag, useDrop} from 'react-dnd'
import {HTML5Backend} from 'react-dnd-html5-backend'


export class PipelineTab extends React.Component<{
  config: Config
  updateConfig: (update: Update<Config>) => void
  errors: ErrorsForPath
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
    fetch("/api/evalfilterstep", {
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
    const errors = this.props.errors
    const pipeline = this.props.config.pipeline
    return <DndProvider backend={HTML5Backend}>
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
                    typeSelect={typeSelect}
                    mixerStep={step}
                    mixers={this.props.config.mixers}
                    update={update => this.updateStep(index, update as Update<PipelineStep>)}
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
            onClose={() => this.setState({plotFilterStep: false})}/>}
      </div>
    </DndProvider>
  }
}

function MixerStepView(props: {
  typeSelect: ReactNode
  mixerStep: MixerStep
  mixers: Mixers
  update: (update: Update<MixerStep>) => void
  errors: ErrorsForPath
  controls: ReactNode
}) {
  const {typeSelect, mixers, mixerStep, update, controls} = props
  const mixer = mixers[mixerStep.name]
  const title = mixer ? `${mixer.channels.in} in, ${mixer.channels.out} out` : ''
  const options = [''].concat(mixerNamesOf(mixers))
  return <Box title={<label>{typeSelect}&nbsp;&nbsp;&nbsp;&nbsp;{title}</label>}>
    <div className="vertically-spaced-content">
      <ErrorMessage message={props.errors({path: [], includeChildren: true})}/>
      <EnumInput
          value={mixerStep.name}
          options={options}
          desc="name"
          data-tip="Mixer name"
          style={{backgroundColor: mixerStep.name === '' ? FIELD_ERROR_BACKGROUND : undefined}}
          onChange={name => update(step => step.name = name)}/>
      <div className="horizontally-spaced-content">{controls}</div>
    </div>
  </Box>
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
  const title = <div>
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
  </div>
  return <Box title={title}>
    <div className="vertically-spaced-content">
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
}

interface FilterDragItem {
  stepIndex: number
  index: number
  name: string
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
  const [{isDragging}, drag, preview] = useDrag(() => ({
    type: 'filter',
    item: {name, stepIndex, index},
    options: {dropEffect: 'move'},
    collect: monitor => ({isDragging: monitor.isDragging()})
  }))
  const [{canDrop}, drop] = useDrop(() => ({
    accept: 'filter',
    collect: (monitor: DropTargetMonitor<FilterDragItem>) => {
      const item = monitor.getItem()
      return {
        canDrop: monitor.isOver() && (item.index !== index || item.stepIndex !== stepIndex)
      }
    },
    drop: (item: FilterDragItem) => moveFilter(item.stepIndex, item.index, stepIndex, index)
  }))
  return <div ref={drop}>
    <div ref={preview} style={{position: 'relative'}}>
      <div className={`horizontally-spaced-content${isDragging ? ' dragSource' : ''}${canDrop ? ' dropTarget' : ''}`}
           style={{alignItems: 'center'}}>
      <span ref={drag} style={{display: "flex", alignItems: 'center'}}>
        <Icon path={mdiDrag} size={'24px'} className="filter-drag-handle" data-tip="Drag filter to sort"/>
      </span>
        <EnumInput
            value={name}
            options={options}
            desc={`step${stepIndex}-filter${index}`}
            data-tip="Filter name"
            style={{
              width: '100%',
              backgroundColor: errors ? FIELD_ERROR_BACKGROUND : undefined
            }}
            onChange={setName}/>
        {controls}
      </div>
      <ErrorMessage message={errors}/>
    </div>
  </div>
}