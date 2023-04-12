import React from "react"
import cloneDeep from "lodash/cloneDeep"
import "./index.css"
import { mdiAlertCircle, mdiChartBellCurveCumulative, mdiFileSearch, mdiUpload, mdiArrowCollapse, mdiArrowExpand } from '@mdi/js'
import {
    Config,
    defaultProcessor,
    Processor,
    Processors,
    newProcessorName,
    removeProcessor,
    renameProcessor,
    sortedProcessorNamesOf,
    SortKeys,
} from "./camilladsp/config"
import {
    AddButton,
    BoolOption,
    Box,
    DeleteButton,
    EnumOption,
    ErrorMessage,
    FloatListOption,
    FloatOption,
    IntOption,
    MdiButton,
    OptionalTextOption,
    ParsedInput,
    TextOption,
} from "./utilities/ui-components"
import { ErrorsForPath, errorsForSubpath } from "./utilities/errors"
import { modifiedCopyOf, Update } from "./utilities/common"
import { isEqual } from "lodash"

export class ProcessorsTab extends React.Component<
    {
        processors: Processors
        updateConfig: (update: Update<Config>) => void
        errors: ErrorsForPath
    },
    {
        processorKeys: { [name: string]: number }
        availableCoeffFiles: string[]
        sortBy: string
        sortReverse: boolean
    }
> {
    constructor(props: any) {
        super(props)
        this.processorNames = this.processorNames.bind(this)
        this.changeSortBy = this.changeSortBy.bind(this)
        this.changeSortOrder = this.changeSortOrder.bind(this)
        this.addProcessor = this.addProcessor.bind(this)
        this.removeProcessor = this.removeProcessor.bind(this)
        this.renameProcessor = this.renameProcessor.bind(this)
        this.isFreeProcessorName = this.isFreeProcessorName.bind(this)
        this.updateProcessor = this.updateProcessor.bind(this)
        this.state = {
            processorKeys: {},
            availableCoeffFiles: [],
            sortBy: "Name",
            sortReverse: false
        }
        this.processorNames().forEach((name, i) => this.state.processorKeys[name] = i)
    }

    //private timer = delayedExecutor(2000)

    private processorNames(): string[] {
        return sortedProcessorNamesOf(this.props.processors, this.state.sortBy, this.state.sortReverse)
    }

    private changeSortBy(key: string) {
        this.setState({ sortBy: key })
    }

    private changeSortOrder(reverse: boolean) {
        this.setState({ sortReverse: reverse })
    }

    private addProcessor() {
        this.props.updateConfig(config => {
            const newProcessor = newProcessorName(config.processors)
            this.setState(oldState =>
                modifiedCopyOf(oldState, newState =>
                    newState.processorKeys[newProcessor] = 1 + Math.max(0, ...Object.values(oldState.processorKeys))
                )
            )
            config.processors[newProcessor] = defaultProcessor()
        })
    }

    private removeProcessor(name: string) {
        this.props.updateConfig(config => {
            removeProcessor(config, name)
            this.setState(oldState =>
                modifiedCopyOf(oldState, newState => delete newState.processorKeys[name]))
        })
    }

    private renameProcessor(oldName: string, newName: string) {
        if (this.isFreeProcessorName(newName))
            this.props.updateConfig(config => {
                this.setState(oldState =>
                    modifiedCopyOf(oldState, newState => {
                        newState.processorKeys[newName] = newState.processorKeys[oldName]
                        delete newState.processorKeys[oldName]
                    }))
                renameProcessor(config, oldName, newName)
            })
    }

    private isFreeProcessorName(name: string): boolean {
        return !this.processorNames().includes(name)
    }

    private updateProcessor(name: string, update: Update<Processor>) {
        this.props.updateConfig(config => update(config.processors[name]))
    }

    render() {
        let { processors, errors } = this.props
        return <div>
            <div className="horizontally-spaced-content" style={{ width: '700px' }}>
                <EnumOption
                    value={this.state.sortBy}
                    options={SortKeys}
                    desc="Sort processors by"
                    data-tip="Property used to sort processors"
                    onChange={this.changeSortBy} />
                <BoolOption
                    value={this.state.sortReverse}
                    desc="Reverse order"
                    data-tip="Reverse display order"
                    onChange={this.changeSortOrder} />
            </div>
            <div className="tabpanel" style={{ width: '700px' }}>
                <ErrorMessage message={errors({ path: [] })} />
                {this.processorNames()
                    .map(name =>
                        <ProcessorView
                            key={this.state.processorKeys[name]}
                            name={name}
                            processor={processors[name]}
                            errors={errorsForSubpath(errors, name)}
                            updateProcessor={update => this.updateProcessor(name, update)}
                            rename={newName => this.renameProcessor(name, newName)}
                            isFreeProcessorName={this.isFreeProcessorName}
                            remove={() => this.removeProcessor(name)}
                        />
                    )}
                <AddButton tooltip="Add a new processor" onClick={this.addProcessor} />
            </div>
        </div>
    }
}

function isCompressor(processor: Processor): boolean {
    return processor.type === 'Compressor'
}


interface ProcessorViewProps {
    name: string
    processor: Processor
    errors: ErrorsForPath
    updateProcessor: (update: Update<Processor>) => void
    rename: (newName: string) => void
    isFreeProcessorName: (name: string) => boolean
    remove: () => void
}

interface ProcessorViewState {
    showDefaults: boolean
}

class ProcessorView extends React.Component<ProcessorViewProps, ProcessorViewState> {

    constructor(props: any) {
        super(props)
        this.updateDefaults = this.updateDefaults.bind(this)
        this.addBand = this.addBand.bind(this)
        this.removeBand = this.removeBand.bind(this)
        this.adjustBand = this.adjustBand.bind(this)
        this.state = {
            showDefaults: false,
        }
    }

    private updateDefaults(filename: string, updateProcessor: boolean = false) {
        const processor = this.props.processor
    }

    private addBand() {
        this.props.updateProcessor(processor => {
            processor.parameters.gains.push(0.0)
        })
    }

    private removeBand() {
        this.props.updateProcessor(processor => {
            processor.parameters.gains.pop()
        })
    }

    private adjustBand(band: number, value: string) {
        const val = parseFloat(value)
        this.props.updateProcessor(processor => {
            processor.parameters.gains[band] = val
        })
    }

    render() {
        const { name, processor } = this.props
        const isValidProcessorName = (newName: string) =>
            name === newName || (newName.trim().length > 0 && this.props.isFreeProcessorName(newName))
        return <Box title={
            <ParsedInput
                style={{ width: '300px' }}
                value={name}
                asString={x => x}
                parseValue={newName => isValidProcessorName(newName) ? newName : undefined}
                data-tip="Processor name, must be unique"
                onChange={newName => this.props.rename(newName)}
                immediate={false}
            />
        }>
            <div style={{ display: 'flex', flexDirection: 'row' }}>
                <div
                    className="vertically-spaced-content"
                    style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <DeleteButton tooltip={"Delete this processor"} onClick={this.props.remove} />
                </div>
                <ProcessorParams
                    processor={this.props.processor}
                    errors={this.props.errors}
                    updateProcessor={this.props.updateProcessor}
                    showDefaults={this.state.showDefaults}
                    setShowDefaults={() => this.setState({ showDefaults: true })} />
            </div>

            {!isCompressor(processor) &&
                <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
                    {processor.parameters.gains.map((gain: number, index: number, gains: [number]) =>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
                                {gain.toFixed(1)}
                            </div>
                            <input className="eqslider" type="range" min="-10" max="10" value={gain} step="0.1" onChange={e => this.adjustBand(index, e.target.value)} />
                            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
                            </div>
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <AddButton tooltip="Add one band" onClick={this.addBand} />
                        <DeleteButton tooltip="Remove one band" onClick={this.removeBand} />
                    </div>
                </div>
            }
        </Box>
    }
}

const defaultParameters: {
    [type: string]: {
        [subtype: string]: {
            [parameter: string]: string | number | number[] | boolean
        }
    }
} = {
    Compressor: {
        Default: { channels: 2, monitor_channels: [0, 1], process_channels: [0, 1], attack: 0.025, release: 1.0, threshold: -25.0, factor: 5.0, makeup_gain: 15.0, soft_clip: false, enable_clip: false, clip_limit: 0.0 },
    },
}

class ProcessorParams extends React.Component<{
    processor: Processor
    errors: ErrorsForPath
    updateProcessor: (update: Update<Processor>) => void
    setShowDefaults: () => void
    showDefaults: boolean
}, unknown> {
    constructor(props: any) {
        super(props)
        this.onDescChange = this.onDescChange.bind(this)
        this.onTypeChange = this.onTypeChange.bind(this)
        this.renderProcessorParams = this.renderProcessorParams.bind(this)
    }

    //private timer = delayedExecutor(1000)

    private onDescChange(desc: string | null) {
        this.props.updateProcessor(processor => {
            processor.description = desc
        })
    }

    private onTypeChange(type: string) {
        this.props.updateProcessor(processor => {
            processor.type = type
            const typeDefaults = defaultParameters[type]
            const firstSubtypeOrDefault = Object.keys(typeDefaults)[0]
            processor.parameters = cloneDeep(typeDefaults[firstSubtypeOrDefault])
        })
    }

    render() {
        const { processor, errors } = this.props
        const defaults = defaultParameters[processor.type]
        return <div style={{ width: '100%', textAlign: 'right' }}>
            <ErrorMessage message={errors({ path: [] })} />
            <EnumOption
                value={processor.type}
                error={errors({ path: ['type'] })}
                options={Object.keys(defaultParameters)}
                desc="type"
                data-tip="Processor type"
                onChange={this.onTypeChange} />
            <ErrorMessage message={errors({ path: ['parameters'] })} />
            {this.renderProcessorParams(processor.parameters, errorsForSubpath(errors, 'parameters'))}
            <OptionalTextOption
                placeholder="none"
                value={processor.description}
                desc="description"
                data-tip="Processor description"
                onChange={this.onDescChange} />
        </div>
    }

    private renderProcessorParams(parameters: { [p: string]: any }, errors: ErrorsForPath) {
        return Object.keys(parameters).map(parameter => {
            if (parameter === 'type') // 'type' is already rendered by parent component
                return null
            const info = this.parameterInfos[parameter]
            if (info === undefined) {
                console.log(`Rendering for processor parameter '${parameter}' is not implemented`)
                return null
            }
            const commonProps = {
                key: parameter,
                value: parameters[parameter],
                error: errors({ path: [parameter] }),
                desc: info.desc,
                'data-tip': info.tooltip,
                //onChange: (value: any) => this.timer(() => this.props.updateProcessor(processor => processor.parameters[parameter] = value))
                onChange: (value: any) => this.props.updateProcessor(processor => processor.parameters[parameter] = value)
            }
            if (info.type === 'text')
                return <TextOption {...commonProps} />
            if (info.type === 'int')
                return <IntOption {...commonProps} />
            if (info.type === 'float')
                return <FloatOption {...commonProps} />
            if (info.type === "bool")
                return <BoolOption {...commonProps} />
            if (info.type === 'floatlist')
                return <FloatListOption {...commonProps} />
            return null
        })
    }

    parameterInfos: {
        [type: string]: {
            type: 'text' | 'int' | 'float' | 'floatlist' | 'bool'
            desc: string
            tooltip: string
        }
    } = {
            attack: {
                type: "float",
                desc: "attack",
                tooltip: "Attack time in seconds",
            },
            channels: {
                type: "int",
                desc: "channels",
                tooltip: "Number of channels",
            },
            clip_limit: { type: "float", desc: "clip_limit", tooltip: "Clip limit in dB" },
            release: {
                type: "float",
                desc: "release",
                tooltip: "Release time in seconds",
            },
            threshold: {
                type: "float",
                desc: "threshold",
                tooltip: "Threshold in dB",
            },
            makeup_gain: {
                type: "float",
                desc: "makeup_gain",
                tooltip: "Makeup gain in dB",
            },
            enable_clip: { type: "bool", desc: "enable_clip", tooltip: "Enable clipping" },
            soft_clip: { type: "bool", desc: "soft_clip", tooltip: "Use soft clipping" },
        }
}