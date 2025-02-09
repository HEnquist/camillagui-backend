import React from "react"
import cloneDeep from "lodash/cloneDeep"
import "./index.css"
import {
    Config,
    defaultProcessor,
    getProcessorChannelLabels,
    Processor,
    newProcessorName,
    removeProcessor,
    renameProcessor,
    sortedProcessorNamesOf,
    ProcessorSortKeys,
} from "./camilladsp/config"
import {
    AddButton,
    BoolOption,
    Box,
    ChannelSelection,
    DeleteButton,
    EnumOption,
    ErrorMessage,
    FloatListOption,
    FloatOption,
    OptionalFloatOption,
    IntOption,
    OptionalTextOption,
    ParsedInput,
    TextOption,
    ErrorBoundary,
} from "./utilities/ui-components"
import {Errors} from "./utilities/errors"
import { modifiedCopyOf, Update } from "./utilities/common"

export class ProcessorsTab extends React.Component<
    {
        config: Config
        updateConfig: (update: Update<Config>) => void
        errors: Errors
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

    private processorNames(): string[] {
        return sortedProcessorNamesOf(this.props.config.processors, this.state.sortBy, this.state.sortReverse)
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
            if (config.processors === null) {
                config.processors = {}
            }
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
        this.props.updateConfig(config => {
            if (config.processors) {
                update(config.processors[name])
            }
        })
    }

    render() {
        let { config, errors } = this.props
        let processors = config.processors ? config.processors : {}
        return <ErrorBoundary errorMessage={errors.asText()}>
            <div>
                <div className="horizontally-spaced-content" style={{ width: '700px' }}>
                    <EnumOption
                        value={this.state.sortBy}
                        options={ProcessorSortKeys}
                        desc="Sort processors by"
                        tooltip="Property used to sort processors"
                        onChange={this.changeSortBy} />
                    <BoolOption
                        value={this.state.sortReverse}
                        desc="Reverse order"
                        tooltip="Reverse display order"
                        onChange={this.changeSortOrder} />
                </div>
                <div className="tabcontainer">
                    <div className="tabpanel-with-header" style={{ width: '700px' }}>
                        <ErrorMessage message={errors.rootMessage()} />
                        {this.processorNames()
                            .map(name =>
                                <ProcessorView
                                    key={this.state.processorKeys[name]}
                                    name={name}
                                    processor={processors[name]}
                                    config={config}
                                    errors={errors.forSubpath(name)}
                                    updateProcessor={update => this.updateProcessor(name, update)}
                                    rename={newName => this.renameProcessor(name, newName)}
                                    isFreeProcessorName={this.isFreeProcessorName}
                                    remove={() => this.removeProcessor(name)}
                                />
                            )}
                        <AddButton tooltip="Add a new processor" onClick={this.addProcessor} />
                    </div>
                    <div className="tabspacer"/>
                </div>
            </div>
        </ErrorBoundary>
    }
}

function hasChannelSelectors(processor: Processor): boolean {
    return processor.type === 'Compressor' || processor.type === 'NoiseGate'
}


interface ProcessorViewProps {
    name: string
    processor: Processor
    config: Config
    errors: Errors
    updateProcessor: (update: Update<Processor>) => void
    rename: (newName: string) => void
    isFreeProcessorName: (name: string) => boolean
    remove: () => void
}

interface ProcessorViewState {}

class ProcessorView extends React.Component<ProcessorViewProps, ProcessorViewState> {

    constructor(props: any) {
        super(props)
        this.state = {}
    }

    render() {
        const { name, processor, config } = this.props
        const isValidProcessorName = (newName: string) =>
            name === newName || (newName.trim().length > 0 && this.props.isFreeProcessorName(newName))
        const channel_labels = getProcessorChannelLabels(config, name)
        return <Box style={{width: '700px' }} title={
            <ParsedInput
                style={{ width: '300px' }}
                value={name}
                asString={x => x}
                parseValue={newName => isValidProcessorName(newName) ? newName : undefined}
                tooltip="Processor name, must be unique"
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
                    processor={processor}
                    errors={this.props.errors}
                    updateProcessor={this.props.updateProcessor}
                    labels={channel_labels} />
            </div>


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
    NoiseGate: {
        Default: { channels: 2, monitor_channels: [0, 1], process_channels: [0, 1], attack: 0.025, release: 1.0, threshold: -25.0, attenuation: 20.0 },
    },
    RACE: {
        Default: { channels: 2, channel_a: 0, channel_b: 1, delay: 80, delay_unit: "us", subsample_delay: false, attenuation: 3.0 },
    },
}

class ProcessorParams extends React.Component<{
    processor: Processor
    errors: Errors
    updateProcessor: (update: Update<Processor>) => void
    labels: (string|null)[] | null
}, unknown> {
    constructor(props: any) {
        super(props)
        this.onDescChange = this.onDescChange.bind(this)
        this.onTypeChange = this.onTypeChange.bind(this)
        this.renderProcessorParams = this.renderProcessorParams.bind(this)
        this.setMonitor = this.setMonitor.bind(this)
        this.setProcess = this.setProcess.bind(this)
        this.setChannelA = this.setChannelA.bind(this)
        this.setChannelB = this.setChannelB.bind(this)
        this.onParamChange = this.onParamChange.bind(this)
    }

    //private timer = delayedExecutor(1000)

    private onParamChange(parameter: string, value: any) {
        this.props.updateProcessor(processor => {
            processor.parameters[parameter] = value
            //if (isCompressor(processor) && parameter === "channels") {
            //    processor.parameters.monitor_channels = processor.parameters.monitor_channels.filter((n: number) => n < value)
            //    processor.parameters.process_channels = processor.parameters.process_channels.filter((n: number) => n < value)
            //}
        })
    }

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

    private setMonitor(channels: number[]|null) {
        this.props.updateProcessor(processor => {
            processor.parameters.monitor_channels = channels
        })
    }
    private setProcess(channels: number[]|null) {
        this.props.updateProcessor(processor => {
            processor.parameters.process_channels = channels
        })
    }
    private setChannelA(channels: number[]|null) {
        if (channels !== null) {
            this.props.updateProcessor(processor => {
                processor.parameters.channel_a = channels[0]
            })
        }
    }
    private setChannelB(channels: number[]|null) {
        if (channels !== null) {
            this.props.updateProcessor(processor => {
                processor.parameters.channel_b = channels[0]
            })
        }
    }



    render() {
        const { processor, errors, labels } = this.props
        return <div style={{ width: '100%', textAlign: 'right' }}>
            <ErrorMessage message={errors.rootMessage()} />
            <EnumOption
                value={processor.type}
                error={errors.messageFor('type')}
                options={Object.keys(defaultParameters)}
                desc="type"
                tooltip="Processor type"
                onChange={this.onTypeChange} />
            <ErrorMessage message={errors.messageFor('parameters')} />
            {this.renderProcessorParams(processor.parameters, errors.forSubpath('parameters'))}
            <OptionalTextOption
                placeholder="none"
                value={processor.description}
                desc="description"
                tooltip="Processor description"
                onChange={this.onDescChange} />
            {hasChannelSelectors(processor) &&
                <div>
                <label className="setting">
                    <span className="setting-label">
                        <div data-tooltip-html="Channels to monitor" data-tooltip-id="main-tooltip">monitor_channels</div>
                    </span>
                    <ChannelSelection label={null} maxChannelCount={processor.parameters.channels} channels={processor.parameters.monitor_channels} setChannels={this.setMonitor} multiSelect={true} labels={labels}/>
                </label>
                <label className="setting">
                    <span className="setting-label">
                        <div data-tooltip-html="Channels to process" data-tooltip-id="main-tooltip">process_channels</div>
                    </span>
                    <ChannelSelection label={null} maxChannelCount={processor.parameters.channels} channels={processor.parameters.process_channels} setChannels={this.setProcess} multiSelect={true} labels={labels}/>
                </label>
                </div>
            }
            {processor.type === "RACE" &&
                <div>
                <label className="setting">
                    <span className="setting-label">
                        <div data-tooltip-html="Channel A" data-tooltip-id="main-tooltip">channel_a</div>
                    </span>
                    <ChannelSelection label={null} maxChannelCount={processor.parameters.channels} channels={[processor.parameters.channel_a]} setChannels={this.setChannelA} multiSelect={false} labels={labels}/>
                </label>
                <label className="setting">
                    <span className="setting-label">
                        <div data-tooltip-html="Channel B" data-tooltip-id="main-tooltip">channel_b</div>
                    </span>
                    <ChannelSelection label={null} maxChannelCount={processor.parameters.channels} channels={[processor.parameters.channel_b]} setChannels={this.setChannelB} multiSelect={false} labels={labels}/>
                </label>
                </div>
            }
        </div>
    }

    private renderProcessorParams(parameters: { [p: string]: any }, errors: Errors) {
        return Object.keys(parameters).map(parameter => {
            if (parameter === 'type') // 'type' is already rendered by parent component
                return null
            if (parameter === 'monitor_channels' || parameter === 'process_channels') // handled separately
                return null
            const info = this.parameterInfos[parameter]
            if (info === undefined) {
                console.log(`Rendering for processor parameter '${parameter}' is not implemented`)
                return null
            }
            const commonProps = {
                key: parameter,
                value: parameters[parameter],
                error: errors.messageFor(parameter),
                desc: info.desc,
                tooltip: info.tooltip,
                onChange: (value: any) => this.onParamChange(parameter, value)
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
            if (info.type === 'optional_float')
                return <OptionalFloatOption placeholder={info.placeholder} {...commonProps} />
            if (info.type === 'enum') {
                let options = info.options!
                return <EnumOption {...commonProps} key={commonProps.key} options={options} />
            }
            return null
        })
    }

    parameterInfos: {
        [type: string]: {
            type: 'text' | 'int' | 'float' | 'floatlist' | 'bool' | 'optional_float' | 'enum'
            desc: string
            tooltip: string
            placeholder?: string
            options?: string[]
        }
    } = {
            attack: {
                type: "float",
                desc: "attack",
                tooltip: "Attack time in seconds",
            },
            attenuation: {
                type: "float",
                desc: "attenuation",
                tooltip: "Attenuation in dB to apply when gate is closed",
            },
            channels: {
                type: "int",
                desc: "channels",
                tooltip: "Number of channels",
            },
            clip_limit: { type: "optional_float", desc: "clip_limit", tooltip: "Clip limit in dB", placeholder: "none" },
            factor: {
                type: "float",
                desc: "factor",
                tooltip: "Compression factor",
            },
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
            soft_clip: { type: "bool", desc: "soft_clip", tooltip: "Use soft clipping" },
            delay: {
                type: "float",
                desc: "delay",
                tooltip: "RACE delay"
            },
            subsample_delay: { type: "bool", desc: "subsample_delay", tooltip: "Enable subsample delay" },
            delay_unit: {
                type: "enum",
                desc: "delay_unit",
                options: ["ms", "us", "mm", "samples"],
                tooltip: "Unit for delay"
            }
        }
}