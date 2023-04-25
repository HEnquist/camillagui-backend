import { sortedAlphabetically } from "../utilities/arrays"

export function defaultConfig(): Config {
    return {
        devices: {
            samplerate: 48000,

            //Buffers
            chunksize: 1024,
            queuelimit: null,

            //Silence
            silence_threshold: null,
            silence_timeout: null,

            //Rate adjust
            enable_rate_adjust: null,
            adjust_period: null,
            target_level: null,

            //Resampler
            resampler: {type: 'AsyncSinc', profile: 'Balanced'},
            capture_samplerate: 44100,

            //Rate monitoring
            stop_on_rate_change: null,
            rate_measure_interval: null,

            capture: { type: 'Alsa', channels: 2, format: 'S32LE', device: null },
            playback: { type: 'Alsa', channels: 2, format: 'S32LE', device: null },
        },
        filters: {},
        mixers: {},
        processors: {},
        pipeline: [],
        title: null,
        description: null
    }
}

export const FilterSortKeys = [
    "Name",
    "Type",
    "Subtype",
    "Frequency",
    "Q-value",
    "Gain",
]

export const ProcessorSortKeys = [
    "Name",
    "Type",
]

function compare_named_vs_unnamed(a: any, b: any): number {
    let a_new = a["name"].startsWith("Unnamed ")
    let b_new = b["name"].startsWith("Unnamed ")
    if (a_new && !b_new) {
        return 1
    }
    else if (!a_new && b_new) {
        return -1
    }
    return 0
}

function compare_values(a: number, b: number, reverse: boolean): number {
    let rev = reverse ? -1 : 1
    if (a === undefined && b !== undefined) {
        return rev
    }
    else if (a !== undefined && b === undefined) {
        return -rev
    }
    else if (a !== b) {
        return rev * (a - b)
    }
    return 0
}

export function filtersSortedAlphabeticallyOnKey(filters: Filters, key: string, reverse: boolean): string[] {
    let names = Object.keys(filters)
    let filters_as_list = names.map(n => ({ name: n, def: filters[n] }));
    let rev = reverse ? -1 : 1
    switch (key) {
        case "Name":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
        case "Frequency":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_val = a["def"]["parameters"]["freq"]
                let b_val = b["def"]["parameters"]["freq"]
                let number_res = compare_values(a_val, b_val, reverse)
                if (number_res !== 0) {
                    return number_res
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
        case "Q-value":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_val = a["def"]["parameters"]["q"]
                let b_val = b["def"]["parameters"]["q"]
                let number_res = compare_values(a_val, b_val, reverse)
                if (number_res !== 0) {
                    return number_res
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
        case "Gain":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_val = a["def"]["parameters"]["gain"]
                let b_val = b["def"]["parameters"]["gain"]
                let number_res = compare_values(a_val, b_val, reverse)
                if (number_res !== 0) {
                    return number_res
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
        case "Type":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_val = a["def"]["type"]
                let b_val = b["def"]["type"]
                if (a_val !== b_val) {
                    return rev * a_val.localeCompare(b_val)
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
        case "Subtype":
            filters_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_type = a["def"]["type"]
                let b_type = b["def"]["type"]
                let a_val = a["def"]["parameters"]["type"]
                let b_val = b["def"]["parameters"]["type"]
                if (a_type !== b_type) {
                    return rev * a_type.localeCompare(b_type)
                }
                else if (a_val === undefined && b_val !== undefined) {
                    return rev
                }
                else if (a_val !== undefined && b_val === undefined) {
                    return -rev
                }
                else if (a_val !== b_val) {
                    return rev * a_val.localeCompare(b_val)
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
    }
    let names_sorted = filters_as_list.map(n => n["name"]);
    return names_sorted
}

export function processorsSortedAlphabeticallyOnKey(processors: Processors, key: string, reverse: boolean): string[] {
    let names = Object.keys(processors)
    let processors_as_list = names.map(n => ({ name: n, def: processors[n] }));
    let rev = reverse ? -1 : 1
    switch (key) {
        case "Name":
            processors_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;

        case "Type":
            processors_as_list.sort((a, b) => {
                let unnamed_res = compare_named_vs_unnamed(a, b)
                if (unnamed_res !== 0) {
                    return unnamed_res
                }
                let a_val = a["def"]["type"]
                let b_val = b["def"]["type"]
                if (a_val !== b_val) {
                    return rev * a_val.localeCompare(b_val)
                }
                return rev * a["name"].localeCompare(b["name"])
            })
            break;
    }
    let names_sorted = processors_as_list.map(n => n["name"]);
    return names_sorted
}

export function sortedFilterNamesOf(configOrFilters: Config | Filters, sortKey: string, reverse: boolean): string[] {
    const filters: Filters = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    return filtersSortedAlphabeticallyOnKey(filters, sortKey, reverse)
}

export function filterNamesOf(configOrFilters: Config | Filters): string[] {
    const filters: Filters = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    return sortedAlphabetically(Object.keys(filters))
}

function isConfig(maybeConfig: Config | Filters | Mixers): maybeConfig is Config {
    return maybeConfig.devices !== undefined
}

export function newFilterName(filters: Filters): string {
    return newName('Unnamed Filter ', filterNamesOf(filters))
}

function newName(prefix: string, existingNames: string[]): string {
    const nameIsAlreadyPresent: (i: number) => boolean =
        i => existingNames.includes(prefix + i.toString())
    for (let i = 1; ; i++)
        if (!nameIsAlreadyPresent(i))
            return prefix + i.toString()
}

export function defaultFilter() {
    return {
        type: "Biquad",
        description: null,
        parameters: { type: "Lowpass", q: 0.5, freq: 1000 },
    }
}

export function removeFilter(config: Config, name: string) {
    delete config.filters[name]
    for (let step of config.pipeline)
        if (step.type === 'Filter')
            step.names = step.names.filter(filterName => filterName !== name)
}

export function renameFilter(config: Config, oldName: string, newName: string) {
    if (filterNamesOf(config).includes(newName))
        throw new Error(`Filter '${newName}' already exists`)
    config.filters[newName] = config.filters[oldName]
    delete config.filters[oldName]
    for (let step of config.pipeline)
        if (step.type === 'Filter')
            for (let i = 0; i < step.names.length; i++)
                if (step.names[i] === oldName)
                    step.names[i] = newName
}

export function processorNamesOf(configOrProcessors: Config | Processors): string[] {
    const processors: Processors = isConfig(configOrProcessors) ? configOrProcessors.processors : configOrProcessors
    return sortedAlphabetically(Object.keys(processors))
}

export function sortedProcessorNamesOf(configOrProcessors: Config | Processors, sortKey: string, reverse: boolean): string[] {
    const processors: Processors = isConfig(configOrProcessors) ? configOrProcessors.processors : configOrProcessors
    return processorsSortedAlphabeticallyOnKey(processors, sortKey, reverse)
}

export function newProcessorName(processors: Processors): string {
    return newName('Unnamed Processor ', processorNamesOf(processors))
}

export function defaultProcessor() {
    return {
        type: "Compressor",
        description: null,
        parameters: { channels: 2, monitor_channels: [0, 1], process_channels: [0, 1], attack: 0.025, release: 1.0, threshold: -25.0, factor: 5.0, makeup_gain: 15.0, soft_clip: false, enable_clip: false, clip_limit: 0.0 },
    }
}

export function removeProcessor(config: Config, name: string) {
    delete config.processors[name]
    const pipeline = config.pipeline
    config.pipeline = pipeline.filter(step => step.type !== 'Processor' || step.name !== name)
}

export function renameProcessor(config: Config, oldName: string, newName: string) {
    if (processorNamesOf(config).includes(newName))
        throw new Error(`Processor '${newName}' already exists`)
    config.processors[newName] = config.processors[oldName]
    delete config.processors[oldName]
    for (let step of config.pipeline)
        if (step.type === 'Processor' && step.name === oldName)
            step.name = newName
}

export function mixerNamesOf(configOrMixers: Config | Mixers): string[] {
    const mixers: Mixers = isConfig(configOrMixers) ? configOrMixers.mixers : configOrMixers
    return sortedAlphabetically(Object.keys(mixers))
}

export function newMixerName(mixers: Mixers): string {
    return newName('Unnamed Mixer ', mixerNamesOf(mixers))
}

export function removeMixer(config: Config, name: string) {
    delete config.mixers[name]
    const pipeline = config.pipeline
    config.pipeline = pipeline.filter(step => step.type !== 'Mixer' || step.name !== name)
}

export function renameMixer(config: Config, oldName: string, newName: string) {
    if (mixerNamesOf(config).includes(newName))
        throw new Error(`Mixer '${newName}' already exists`)
    config.mixers[newName] = config.mixers[oldName]
    delete config.mixers[oldName]
    for (let step of config.pipeline)
        if (step.type === 'Mixer' && step.name === oldName)
            step.name = newName
}

export function defaultMixer(): Mixer {
    return {
        description: null,
        channels: { in: 2, out: 2 },
        mapping: [defaultMapping(2, [])]
    }
}

export function defaultMapping(outChannels: number, mappings: Mapping[]): Mapping {
    if (mappings.length >= outChannels)
        throw new Error(`Cannot add more than ${outChannels} (out) mappings`)
    return {
        dest: mappings.length,
        sources: [defaultSource(0, [])],
        mute: false
    }
}

export function defaultSource(inChannels: number, sources: Source[]): Source {
    const newChannel = sources.length < inChannels ? sources.length : 0
    return { channel: newChannel, gain: 0, inverted: false, mute: false, scale: 'dB' }
}

export function defaultFilterStep(config: Config): FilterStep {
    const filterNames = filterNamesOf(config)
    return {
        type: 'Filter',
        channel: 0,
        names: filterNames.length === 1 ? [filterNames[0]] : [''],
        description: null,
        bypassed: null
    }
}

export function defaultMixerStep(config: Config): MixerStep {
    const mixerNames = mixerNamesOf(config)
    return {
        type: 'Mixer',
        name: mixerNames.length === 1 ? mixerNames[0] : '',
        description: null,
        bypassed: null
    }
}

export function defaultProcessorStep(config: Config): ProcessorStep {
    const processorNames = processorNamesOf(config)
    return {
        type: 'Processor',
        name: processorNames.length === 1 ? processorNames[0] : '',
        description: null,
        bypassed: null
    }
}

export interface Config {
    devices: Devices,
    filters: Filters,
    mixers: Mixers,
    processors: Processors,
    pipeline: Pipeline,
    title: string | null,
    description: string | null
}

export interface Devices {
    samplerate: number,

    //Buffers
    chunksize: number,
    queuelimit: number | null,

    //Silence
    silence_threshold: number | null,
    silence_timeout: number | null,

    //Rate adjust
    enable_rate_adjust: boolean | null,
    adjust_period: number | null,
    target_level: number | null,

    //Resampler
    resampler: Resampler | null,
    capture_samplerate: number,

    //Rate monitoring
    stop_on_rate_change: boolean | null,
    rate_measure_interval: number | null,

    capture: CaptureDevice,
    playback: PlaybackDevice,
}

export type ResamplerType = 'AsyncSinc' | 'AsyncPoly' | 'Synchronous'
export const ResamplerTypes: ResamplerType[] = ["AsyncSinc", "AsyncPoly", "Synchronous"]
export type AsyncSincProfile = 'VeryFast' | 'Fast' | 'Balanced' | 'Accurate' | 'Free'
export const AsyncSincProfiles: AsyncSincProfile[] = ["VeryFast", "Fast", "Balanced", "Accurate", "Free"]
export type AsyncSincInterpolation = 'Nearest' | 'Linear' | 'Quadratic' | 'Cubic'
export const AsyncSincInterpolations: AsyncSincInterpolation[] = ['Nearest', 'Linear', 'Quadratic', 'Cubic']
export type AsyncPolyInterpolation = 'Linear' | 'Cubic' | 'Quintic' | 'Septic'
export const AsyncPolyInterpolations: AsyncPolyInterpolation[] = ['Linear', 'Cubic', 'Quintic', 'Septic']
export type AsyncSincWindow = 'Blackman' | 'Blackman2' | 'BlackmanHarris' | 'BlackmanHarris2' | 'Hann' | 'Hann2'
export const AsyncSincWindows = ['Blackman', 'Blackman2', 'BlackmanHarris', 'BlackmanHarris2', 'Hann', 'Hann2']


export type Resampler =
    { type: 'AsyncSinc', profile: AsyncSincProfile }
    | { type: 'AsyncSinc', sinc_len: number, oversampling_factor: number, interpolation: AsyncSincInterpolation, window: AsyncSincWindow, f_cutoff: number | null }
    | { type: 'AsyncPoly', interpolation: AsyncPolyInterpolation }
    | { type: 'Synchronous' }

export function defaultResampler(type: ResamplerType): Resampler {
    if (type === "AsyncSinc") {
        return {
            type: "AsyncSinc",
            profile: "Balanced",
        }
    } else if (type === "AsyncPoly") {
        return {
            type: "AsyncPoly",
            interpolation: "Cubic",
        }
    }
    return {
        type: "Synchronous",
    }
}

export function defaultSincResampler(profile: AsyncSincProfile): Resampler {
    if (profile === "Free") {
        return {
            type: "AsyncSinc",
            sinc_len: 128,
            oversampling_factor: 256,
            interpolation: "Quadratic",
            window: "BlackmanHarris2",
            f_cutoff: null
        }
    }
    return {
        type: "AsyncSinc",
        profile: profile,
    }
}

export type Fader = 'Main' | 'Aux1' | 'Aux2' | 'Aux3' | 'Aux4'
export const LoudnessFaders: Fader[] = ['Main', 'Aux1', 'Aux2', 'Aux3', 'Aux4']
export const VolumeFaders: Fader[] = ['Aux1', 'Aux2', 'Aux3', 'Aux4']


export type CaptureDevice =
    { type: 'Alsa', channels: number, format: Format, device: string | null }
    | { type: 'Wasapi', channels: number, format: Format, device: string | null, exclusive: boolean | null, loopback: boolean | null }
    | { type: 'Jack', channels: number, device: string }
    | { type: 'CoreAudio', channels: number, format: Format | null, device: string | null, change_format: boolean | null }
    | { type: 'Pulse', channels: number, format: Format, device: string }
    | {
        type: 'File', channels: number, format: Format, filename: '/path/to/file',
        extra_samples: number | null, skip_bytes: number | null, read_bytes: number | null
    }
    | {
        type: 'Stdin', channels: number, format: Format,
        extra_samples: number | null, skip_bytes: number | null, read_bytes: number | null
    } | {
        type: 'Bluez', channels: number, format: Format,
        service: string | null, dbus_path: string
    }

export type PlaybackDevice =
    { type: 'Wasapi', channels: number, format: Format, device: string | null, exclusive: boolean | null }
    | { type: 'Jack', channels: number, device: string }
    | { type: 'Alsa', channels: number, format: Format, device: string | null }
    | { type: 'Pulse', channels: number, format: Format, device: string }
    | { type: 'CoreAudio', channels: number, format: Format | null, device: string | null, exclusive: boolean | null, change_format: boolean | null }
    | { type: 'File', channels: number, format: Format, filename: string }
    | { type: 'Stdout', channels: number, format: Format }

export type Format = 'S16LE' | 'S24LE' | 'S24LE3' | 'S32LE' | 'FLOAT32LE' | 'FLOAT64LE'
export const Formats: Format[] = ['S16LE', 'S24LE', 'S24LE3', 'S32LE', 'FLOAT32LE', 'FLOAT64LE']

export type GainScale = 'linear' | 'dB'
export const GainScales: GainScale[] = ['linear', 'dB']

export interface Filters {
    [name: string]: Filter
}
export interface Filter {
    type: string
    description: string | null
    parameters: { [name: string]: any }
}

export interface Processors {
    [name: string]: Processor
}
export interface Processor {
    type: string
    description: string | null
    parameters: { [name: string]: any }
}

export type Mixers = {
    [name: string]: Mixer
}

export interface Mixer {
    description: string | null
    channels: {
        in: number
        out: number
    }
    mapping: Mapping[]
}

export interface Mapping {
    dest: number
    sources: Source[]
    mute: boolean | null
}

export interface Source {
    channel: number
    gain: number | null
    scale: GainScale | null
    inverted: boolean | null
    mute: boolean | null
}

export type Pipeline = PipelineStep[]
export type PipelineStep = MixerStep | FilterStep | ProcessorStep
export interface MixerStep { type: 'Mixer', name: string, description: string | null, bypassed: boolean | null }
export interface ProcessorStep { type: 'Processor', name: string, description: string | null, bypassed: boolean | null }
export interface FilterStep { type: 'Filter', channel: number, names: string[], description: string | null, bypassed: boolean | null }

export function filterGain(config: Config, filterName: string): number | undefined {
    return config.filters[filterName]?.parameters?.gain
}

export function filterParameter(config: Config, filterName: string, param: string): number | undefined {
    const parameters = config.filters[filterName]?.parameters
    if (parameters !== undefined && parameters.hasOwnProperty(param))
        return parameters[param]
}

export function setFilterParameter(config: Config, filterName: string, param: string, value: number) {
    const parameters = config.filters[filterName]?.parameters
    if (parameters !== undefined && parameters.hasOwnProperty(param))
        parameters[param] = value
}