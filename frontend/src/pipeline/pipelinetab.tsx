import React, {ReactNode} from "react"
import "../index.css"
import {PipelinePopup} from './pipelineplotter'
import {
  AddButton,
  Box,
  DeleteButton,
  EnumInput,
  ERROR_BACKGROUND_STYLE,
  ErrorMessage,
  IntInput,
  MdiButton,
  OptionalBoolOption,
  OptionalTextInput,
  OptionLine,
  PlotButton,
  UploadButton
} from "../utilities/ui-components"
import {
  Config,
  defaultFilterStep,
  defaultMixerStep,
  defaultProcessorStep,
  EMPTY,
  filterNamesOf,
  Filters,
  FilterStep,
  maxChannelCount,
  mixerNamesOf,
  Mixers,
  MixerStep,
  Pipeline,
  PipelineStep,
  processorNamesOf,
  Processors,
  ProcessorStep
} from "../camilladsp/config"
import {mdiArrowDownBold, mdiArrowUpBold, mdiFileUploadOutline} from "@mdi/js"
import {ErrorsForPath, errorsForSubpath} from "../utilities/errors"
import {DndContainer, DndSortable, DragHandle, useDndSort} from "../utilities/dragndrop"
import {moveItem, moveItemDown, moveItemUp} from "../utilities/arrays"
import {Update} from "../utilities/common"
import {importCdspYamlFilters, importEqApoFilters} from "./filterimport"
import {renderToString} from "react-dom/server"
import {ChartData, ChartPopup} from "../utilities/chart"

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

  setStepType = (index: number, type: 'Filter' | 'Mixer' | 'Processor') =>
      this.updatePipeline(pipeline => {
        if (type === 'Mixer')
          pipeline[index] = defaultMixerStep(this.props.config)
        else if (type === 'Filter')
          pipeline[index] = defaultFilterStep(this.props.config)
        else if (type === 'Processor')
          pipeline[index] = defaultProcessorStep(this.props.config)
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
    const {config, errors} = this.props
    const pipeline = config.pipeline
    return <DndContainer>
      <div className="tabpanel" style={{width: '700px'}}>
        <ErrorMessage message={errors({path: []})}/>
        <div className="pipeline-channel">
          Capture: {config.devices.capture.channels} channels in
        </div>
        {pipeline.map((step: PipelineStep, index: number) => {
              const stepErrors = errorsForSubpath(errors, index)
              const typeSelect = <EnumInput
                  value={step.type}
                  options={['Mixer', 'Filter', 'Processor']}
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
                    maxChannelCount={maxChannelCount(config, index)}
                    typeSelect={typeSelect}
                    filterStep={step}
                    filters={config.filters}
                    updatePipeline={this.updatePipeline}
                    updateConfig={this.props.updateConfig}
                    plot={() => this.plotFilterStep(index)}
                    errors={stepErrors}
                    controls={controls}/>
              if (step.type === 'Mixer')
                return <MixerStepView
                    key={index}
                    stepIndex={index}
                    typeSelect={typeSelect}
                    mixerStep={step}
                    mixers={config.mixers}
                    updatePipeline={this.updatePipeline}
                    errors={stepErrors}
                    controls={controls}/>
              if (step.type === 'Processor')
                return <ProcessorStepView
                    key={index}
                    stepIndex={index}
                    typeSelect={typeSelect}
                    processorStep={step}
                    processors={config.processors}
                    updatePipeline={this.updatePipeline}
                    errors={stepErrors}
                    controls={controls}/>
              else
                return null
            }
        )}
        <div className="horizontally-spaced-content">
          <AddButton tooltip="Add a pipeline step" onClick={this.addStep}/>
          <PlotButton tooltip="Plot the pipeline" pipeline={true} onClick={() => this.setState({plotPipeline: true})}/>
        </div>
        <div className="pipeline-channel">
          Playback: {config.devices.playback.channels} channels out
        </div>
        <PipelinePopup
            key={this.state.plotPipeline as any}
            open={this.state.plotPipeline}
            config={config}
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
  const channelInfo = mixer ? <>{mixer.channels.in}&nbsp;in,&nbsp;{mixer.channels.out}&nbsp;out&nbsp;&nbsp;&nbsp;&nbsp;</> : null
  const options = [EMPTY].concat(mixerNamesOf(mixers))
  const nameError = props.errors({path: ['name']})
  const dndProps = usePipelineStepDndSort(stepIndex, updatePipeline)
  return <DndSortable {...dndProps}>
    <Box title={
      <>
        <DragHandle drag={dndProps.drag} tooltip="Drag mixer to change order"/>
        {typeSelect}&nbsp;&nbsp;&nbsp;&nbsp;{channelInfo}
        <OptionalBoolOption
            value={mixerStep.bypassed}
            desc="bypassed"
            data-tip="Bypass this pipeline step"
            onChange={bp => update(step => step.bypassed = bp)}/>
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
        <OptionalTextInput
            placeholder="description"
            value={mixerStep.description}
            data-tip="Pipeline step description"
            onChange={desc => update(step => step.description = desc)}/>
      </div>
    </Box>
  </DndSortable>
}

function ProcessorStepView(props: {
  stepIndex: number
  typeSelect: ReactNode
  processorStep: ProcessorStep
  processors: Processors
  updatePipeline: (update: Update<Pipeline>) => void
  errors: ErrorsForPath
  controls: ReactNode
}) {
  const {stepIndex, typeSelect, processors, processorStep, updatePipeline, controls} = props
  const update = (update: Update<ProcessorStep>) => updatePipeline(pipeline => update(pipeline[stepIndex] as ProcessorStep))
  const options = [EMPTY].concat(processorNamesOf(processors))
  const nameError = props.errors({path: ['name']})
  const dndProps = usePipelineStepDndSort(stepIndex, updatePipeline)
  return <DndSortable {...dndProps}>
    <Box title={
      <>
        <DragHandle drag={dndProps.drag} tooltip="Drag mixer to change order"/>
        {typeSelect}
        <OptionalBoolOption
            value={processorStep.bypassed}
            desc="bypassed"
            data-tip="Bypass this pipeline step"
            onChange={bp => update(step => step.bypassed = bp)}/>
      </>
    }>
      <div className="vertically-spaced-content">
        <ErrorMessage message={props.errors({path: []})}/>
        <ErrorMessage message={props.errors({path: ['type']})}/>
        <EnumInput
            value={processorStep.name}
            options={options}
            desc="name"
            data-tip="Processor name"
            style={nameError ? ERROR_BACKGROUND_STYLE : undefined}
            onChange={name => update(step => step.name = name)}/>
        <ErrorMessage message={nameError}/>
        <div className="horizontally-spaced-content">{controls}</div>
        <OptionalTextInput
            placeholder="description"
            value={processorStep.description}
            data-tip="Pipeline step description"
            onChange={desc => update(step => step.description = desc)}/>
      </div>
    </Box>
  </DndSortable>
}

function FilterStepView(props: {
  stepIndex: number
  maxChannelCount: number
  typeSelect: ReactNode
  filterStep: FilterStep
  filters: Filters
  updatePipeline: (update: Update<Pipeline>) => void
  updateConfig: (update: Update<Config>) => void
  plot: () => void
  errors: ErrorsForPath
  controls: ReactNode
}) {
  const {
    stepIndex, typeSelect, filterStep, filters, updatePipeline, updateConfig, plot, controls, maxChannelCount
  } = props
  const options = [EMPTY].concat(filterNamesOf(filters))
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
    <DragHandle drag={dndProps.drag} tooltip="Drag filter step to change order"/>
    {typeSelect}&nbsp;&nbsp;&nbsp;&nbsp;
    <OptionLine  desc="channel" data-tip="Channel number to process">
      <IntInput
          className="small-setting-input"
          style={{marginLeft: '5px'}}
          value={filterStep.channel}
          data-tip="Channel number to process"
          withControls={true}
          min={0}
          max={maxChannelCount-1}
          onChange={channel => update(step => step.channel = channel)}/>
    </OptionLine>
    <OptionalBoolOption
            value={filterStep.bypassed}
            desc="bypassed"
            data-tip="Bypass this pipeline step"
            onChange={bp => update(step => step.bypassed = bp)}/>
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
          <ImportCdspYamlFiltersButton import={files => importCdspYamlFilters(files, updateConfig, update)}/>
          <ImportEqApoFiltersButton import={files => importEqApoFilters(files, updateConfig, update)}/>
          <PlotButton tooltip="Plot response of this step" onClick={plot}/>
        </div>
        <OptionalTextInput
          placeholder="description"
          value={filterStep.description}
          data-tip="Pipeline step description"
          onChange={desc => update(step => step.description = desc)}/>
      </div>
    </Box>
  </DndSortable>
}

export function ImportCdspYamlFiltersButton(props: {
  import: (files: FileList) => void
}) {
  const tooltipWithHtml = renderToString(<>
    Import filters from CamillaDSP Yaml filter file.<br/>
    If filters with the same name are present in this config, they will be overwritten.<br/>
    Only missing filters will be added to this step.<br/>
    <br/>
    Example file:<br/>
    <br/>
    Filter1:<br/>
    &nbsp;&nbsp;type: Gain<br/>
    &nbsp;&nbsp;parameters:<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;gain: -6<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;scale: dB<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;inverted: false<br/>
    Filter2:<br/>
    &nbsp;&nbsp;type: Delay<br/>
    &nbsp;&nbsp;parameters:<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;delay: 0<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;subsample: false<br/>
    &nbsp;&nbsp;&nbsp;&nbsp;unit: ms<br/>
  </>)
  return <UploadButton
      icon={mdiFileUploadOutline}
      text={"CDSP"}
      htmlTooltip={true}
      tooltip={tooltipWithHtml}
      upload={props.import} />
}

export function ImportEqApoFiltersButton(props: {
  import: (files: FileList) => void
}) {
  const tooltipWithHtml = renderToString(<>
    Import filters from EqualizerAPO filter file.<br/>
    Only Preamp(Gain), LSC(Lowshelf), PK(Peaking) and HSC(Highshelf) filters will be imported.<br/>
    This should be sufficient for EqAPO filters generated by REW and AutoEQ.<br/>
    If filters with the same name are present in this config, they will be overwritten.<br/>
    Only missing filters will be added to this step.<br/>
    <br/>
    Example file:<br/>
    <br/>
    Filter  1: ON  PK       Fc   50.00 Hz  Gain  -5.00 dB  Q 5.00<br/>
    Filter  2: ON  PK       Fc   100.00 Hz  Gain  10.00 dB  Q 1.00<br/>
  </>)
  return <UploadButton
      icon={mdiFileUploadOutline}
      text={"EqAPO"}
      htmlTooltip={true}
      tooltip={tooltipWithHtml}
      upload={props.import} />
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
      <DragHandle drag={drag} tooltip="Drag filter to change order"/>
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