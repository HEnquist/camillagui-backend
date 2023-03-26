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
            enable_resampling: true,
            resampler_type: 'FastAsync',
            capture_samplerate: 44100,

            //Rate monitoring
            stop_on_rate_change: null,
            rate_measure_interval: null,

            capture: { type: 'Alsa', channels: 2, format: 'S32LE', device: null },
            playback: { type: 'Alsa', channels: 2, format: 'S32LE', device: null },
        },
        filters: {},
        mixers: {},
        pipeline: [],
    }
}



export const SortKeys = [
    "Name",
    "Type",
    "Subtype",
    "Frequency",
    "Q-value",
    "Gain",
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
    let rev = reverse ? -1: 1
    if (a === undefined && b !== undefined) {
        return rev
    }
    else if (a !== undefined && b === undefined) {
        return -rev
    }
    else if (a !== b) {
        return rev*(a - b)
    }
    return 0
}

export function sortedAlphabeticallyOnKey(filters: Filters, key: string, reverse: boolean): string[] {
    let names = Object.keys(filters)
    let filters_as_list = names.map(n => ({ name: n, def: filters[n] }));
    let rev = reverse ? -1: 1
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
                return rev*a["name"].localeCompare(b["name"])
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
                return rev*a["name"].localeCompare(b["name"])
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
                return rev*a["name"].localeCompare(b["name"])
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
                    return rev*a_val.localeCompare(b_val)
                }
                return rev*a["name"].localeCompare(b["name"])
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
                    return rev*a_type.localeCompare(b_type)
                }
                else if (a_val === undefined && b_val !== undefined) {
                    return rev
                }
                else if (a_val !== undefined && b_val === undefined) {
                    return -rev
                }
                else if (a_val !== b_val) {
                    return rev*a_val.localeCompare(b_val)
                }
                return rev*a["name"].localeCompare(b["name"])
            })
            break;
        //#array.sort((a, b) => a.localeCompare(b))
    }
    let names_sorted = filters_as_list.map(n => n["name"]);
    //if (reverse) {
    //    names_sorted.reverse()
    //}
    return names_sorted
}

export function sortedFilterNamesOf(configOrFilters: Config | Filters, sortKey: string, reverse: boolean): string[] {
    const filters: Filters = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    return sortedAlphabeticallyOnKey(filters, sortKey, reverse)
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
    return { channel: newChannel, gain: 0, inverted: false, mute: false }
}

export function defaultFilterStep(config: Config): FilterStep {
    const filterNames = filterNamesOf(config)
    return {
        type: 'Filter',
        channel: 0,
        names: filterNames.length === 1 ? [filterNames[0]] : ['']
    }
}

export function defaultMixerStep(config: Config): MixerStep {
    const mixerNames = mixerNamesOf(config)
    return {
        type: 'Mixer',
        name: mixerNames.length === 1 ? mixerNames[0] : ''
    }
}

export interface Config {
    devices: Devices,
    filters: Filters,
    mixers: Mixers,
    pipeline: Pipeline,
}

export interface Devices {
    samplerate: number,

    //Buffers
    chunksize: number,
    queuelimit: number | null,

    //Silence
    silence_threshold: number|null,
    silence_timeout: number|null,

    //Rate adjust
    enable_rate_adjust: boolean|null,
    adjust_period: number|null,
    target_level: number|null,

    //Resampler
    enable_resampling: boolean,
    resampler_type: ResamplerType,
    capture_samplerate: number,

    //Rate monitoring
    stop_on_rate_change: boolean|null,
    rate_measure_interval: number|null,

    capture: CaptureDevice,
    playback: PlaybackDevice,
}

export type ResamplerType = 'FastAsync' | 'BalancedAsync' | 'AccurateAsync' | 'Synchronous'
export const ResamplerTypes: ResamplerType[] = ["FastAsync", "BalancedAsync", "AccurateAsync", "Synchronous"]


export type CaptureDevice =
    { type: 'Alsa', channels: number, format: Format, device: string|null }
    | { type: 'Wasapi', channels: number, format: Format, device: string|null, exclusive: boolean|null, loopback: boolean|null }
    | { type: 'Jack', channels: number, device: string }
    | { type: 'CoreAudio', channels: number, format: Format|null, device: string|null, change_format: boolean|null }
    | { type: 'Pulse', channels: number, format: Format, device: string }
    | {
        type: 'File', channels: number, format: Format, filename: '/path/to/file',
        extra_samples: number|null, skip_bytes: number|null, read_bytes: number|null
    }
    | {
        type: 'Stdin', channels: number, format: Format,
        extra_samples: number|null, skip_bytes: number|null, read_bytes: number|null
    }

export type PlaybackDevice =
    { type: 'Wasapi', channels: number, format: Format, device: string|null, exclusive: boolean|null }
    | { type: 'Jack', channels: number, device: string }
    | { type: 'Alsa', channels: number, format: Format, device: string|null }
    | { type: 'Pulse', channels: number, format: Format, device: string }
    | { type: 'CoreAudio', channels: number, format: Format|null, device: string|null, exclusive: boolean|null, change_format: boolean|null }
    | { type: 'File', channels: number, format: Format, filename: string }
    | { type: 'Stdout', channels: number, format: Format }

export type Format = 'S16LE' | 'S24LE' | 'S24LE3' | 'S32LE' | 'FLOAT32LE' | 'FLOAT64LE'
export const Formats: Format[] = ['S16LE', 'S24LE', 'S24LE3', 'S32LE', 'FLOAT32LE', 'FLOAT64LE']

export interface Filters {
    [name: string]: Filter
}
export interface Filter {
    type: string
    parameters: { [name: string]: any }
}

export type Mixers = {
    [name: string]: Mixer
}

export interface Mixer {
    channels: {
        in: number
        out: number
    }
    mapping: Mapping[]
}

export interface Mapping {
    dest: number
    sources: Source[]
    mute: boolean
}

export interface Source {
    channel: number
    gain: number
    inverted: boolean
    mute: boolean
}

export type Pipeline = PipelineStep[]
export type PipelineStep = MixerStep | FilterStep
export interface MixerStep { type: 'Mixer', name: string }
export interface FilterStep { type: 'Filter', channel: number, names: string[] }

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