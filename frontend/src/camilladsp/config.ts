import { sortedAlphabetically } from "../utilities/arrays"
import {List} from "immutable"

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

            volume_ramp_time: null,

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

export function sortedFilterNamesOf(configOrFilters: Config | Filters | null, sortKey: string, reverse: boolean): string[] {
    if (configOrFilters === null) {
        return []
    }
    const filters: Filters | null = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    if (filters) {
        return filtersSortedAlphabeticallyOnKey(filters, sortKey, reverse)
    }
    return []
}

export function filterNamesOf(configOrFilters: Config | Filters | null): string[] {
    if (configOrFilters === null) {
        return []
    }
    const filters: Filters | null = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    if (filters === null) {
        return []
    }
    return sortedAlphabetically(Object.keys(filters))
}

function isConfig(maybeConfig: Config | Filters | Mixers): maybeConfig is Config {
    return maybeConfig !== null && maybeConfig.hasOwnProperty("devices")
}

export function newFilterName(filters: Filters | null): string {
    return newName('Unnamed Filter ', filterNamesOf(filters))
}

function newName(prefix: string, existingNames: string[]): string {
    const nameIsAlreadyPresent: (i: number) => boolean =
        i => existingNames.includes(prefix + i.toString())
    for (let i = 1; ; i++)
        if (!nameIsAlreadyPresent(i))
            return prefix + i.toString()
}

export const DefaultFilterParameters: {
    [type: string]: {
        [subtype: string]: {
            [parameter: string]: string | number | number[] | boolean
        }
    }
} = {
    Biquad: {
        Lowpass: { type: "Lowpass", freq: 1000, q: 0.5 },
        Highpass: { type: "Highpass", freq: 1000, q: 0.5 },
        Lowshelf: { type: "Lowshelf", gain: 6, freq: 1000, slope: 6 },
        Highshelf: { type: "Highshelf", gain: 6, freq: 1000, slope: 6 },
        LowpassFO: { type: "LowpassFO", freq: 1000 },
        HighpassFO: { type: "HighpassFO", freq: 1000 },
        LowshelfFO: { type: "LowshelfFO", gain: 6, freq: 1000 },
        HighshelfFO: { type: "HighshelfFO", gain: 6, freq: 1000 },
        Peaking: { type: "Peaking", gain: 6, freq: 1000, q: 1.5 },
        Notch: { type: "Notch", freq: 1000, q: 1.5 },
        GeneralNotch: { type: "GeneralNotch", freq_z: 1000, freq_p: 1000, q_p: 1.0, normalize_at_dc: false },
        Bandpass: { type: "Bandpass", freq: 1000, q: 0.5 },
        Allpass: { type: "Allpass", freq: 1000, q: 0.5 },
        AllpassFO: { type: "AllpassFO", freq: 1000 },
        LinkwitzTransform: { type: "LinkwitzTransform", q_act: 1.5, q_target: 0.5, freq_act: 50, freq_target: 25 },
        Free: { type: "Free", a1: 0.0, a2: 0.0, b0: -1.0, b1: 1.0, b2: 0.0 },
    },
    BiquadCombo: {
        ButterworthLowpass: { type: "ButterworthLowpass", order: 2, freq: 1000 },
        ButterworthHighpass: { type: "ButterworthHighpass", order: 2, freq: 1000 },
        LinkwitzRileyLowpass: { type: "LinkwitzRileyLowpass", order: 2, freq: 1000 },
        LinkwitzRileyHighpass: { type: "LinkwitzRileyHighpass", order: 2, freq: 1000 },
        Tilt: { type: "Tilt", gain: 0.0 },
        GraphicEqualizer: { type: "GraphicEqualizer", freq_min: 20.0, freq_max: 20000.0, gains: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]},
    },
    Conv: {
        Raw: { type: "Raw", filename: "", format: "TEXT", skip_bytes_lines: 0, read_bytes_lines: 0 },
        Wav: { type: "Wav", filename: "", channel: 0 },
        Values: { type: "Values", values: [1.0, 0.0, 0.0, 0.0] },
        Dummy: { type: "Dummy", length: 1024 }
    },
    Delay: {
        Default: { delay: 0.0, unit: "ms", subsample: false },
    },
    Gain: {
        Default: { gain: 0.0, scale: 'dB', inverted: false, mute: false },
    },
    Volume: {
        Default: { ramp_time: 200, fader: "Aux1" },
    },
    Loudness: {
        Default: { reference_level: 0.0, high_boost: 5, low_boost: 5, fader: "Main", attenuate_mid: false },
    },
    DiffEq: {
        Default: { a: [1.0, 0.0], b: [1.0, 0.0] },
    },
    Dither: {
        None: { type: "None", bits: 16 },
        Flat: { type: "Flat", bits: 16, amplitude: 2.0 },
        Highpass: { type: "Highpass", bits: 16 },
        Fweighted441: { type: "Fweighted441", bits: 16 },
        FweightedLong441: { type: "FweightedLong441", bits: 16 },
        FweightedShort441: { type: "FweightedShort441", bits: 16 },
        Gesemann441: { type: "Gesemann441", bits: 16 },
        Gesemann48: { type: "Gesemann48", bits: 16 },
        Lipshitz441: { type: "Lipshitz441", bits: 16 },
        LipshitzLong441: { type: "LipshitzLong441", bits: 16 },
        Shibata441: { type: "Shibata441", bits: 16 },
        ShibataHigh441: { type: "ShibataHigh441", bits: 16 },
        ShibataLow441: { type: "ShibataLow441", bits: 16 },
        Shibata48: { type: "Shibata48", bits: 16 },
        ShibataHigh48: { type: "ShibataHigh48", bits: 16 },
        ShibataLow48: { type: "ShibataLow48", bits: 16 },
        Shibata882: { type: "Shibata882", bits: 16 },
        ShibataLow882: { type: "ShibataLow882", bits: 16 },
        Shibata96: { type: "Shibata96", bits: 16 },
        ShibataLow96: { type: "ShibataLow96", bits: 16 },
        Shibata192: { type: "Shibata192", bits: 16 },
        ShibataLow192: { type: "ShibataLow192", bits: 16 },
    },
    Limiter: {
        Default: { soft_clip: false, clip_limit: 0.0 }
    },
}

export function defaultFilter() {
    return {
        type: "Biquad",
        description: null,
        parameters: DefaultFilterParameters.Biquad.Lowpass,
    }
}

export function removeFilter(config: Config, name: string) {
    delete config.filters?.[name]
    if (config.pipeline) {
        for (let step of config.pipeline)
            if (step.type === 'Filter')
                step.names = step.names.filter(filterName => filterName !== name)
    }
}

export function renameFilter(config: Config, oldName: string, newName: string) {
    if (filterNamesOf(config).includes(newName))
        throw new Error(`Filter '${newName}' already exists`)
    if (config.filters) {
        config.filters[newName] = config.filters[oldName]
        delete config.filters[oldName]
        for (let step of config.pipeline ? config.pipeline: [])
            if (step.type === 'Filter')
                for (let i = 0; i < step.names.length; i++)
                    if (step.names[i] === oldName)
                        step.names[i] = newName
    }
}

export function processorNamesOf(configOrProcessors: Config | Processors | null): string[] {
    if (configOrProcessors === null) {
        return []
    }
    const processors: Processors | null = isConfig(configOrProcessors) ? configOrProcessors.processors : configOrProcessors
    if (processors) {
        return sortedAlphabetically(Object.keys(processors))
    }
    return []
}

export function sortedProcessorNamesOf(configOrProcessors: Config | Processors | null, sortKey: string, reverse: boolean): string[] {
    if (configOrProcessors === null) {
        return []
    }
    const processors: Processors | null = isConfig(configOrProcessors) ? configOrProcessors.processors : configOrProcessors
    if (processors) {
        return processorsSortedAlphabeticallyOnKey(processors, sortKey, reverse)
    }
    return []
}

export function newProcessorName(processors: Processors | null): string {
    return newName('Unnamed Processor ', processorNamesOf(processors))
}

export function defaultProcessor() {
    return {
        type: "Compressor",
        description: null,
        parameters: { channels: 2, monitor_channels: [0, 1], process_channels: [0, 1], attack: 0.025, release: 1.0, threshold: -25.0, factor: 5.0, makeup_gain: 15.0, clip_limit: null, soft_clip: false },
    }
}

export function removeProcessor(config: Config, name: string) {
    delete config.processors?.[name]
    const pipeline = config.pipeline
    if (pipeline)
        config.pipeline = pipeline.filter(step => step.type !== 'Processor' || step.name !== name)
}

export function renameProcessor(config: Config, oldName: string, newName: string) {
    if (processorNamesOf(config).includes(newName))
        throw new Error(`Processor '${newName}' already exists`)
    if (config.processors) {
        config.processors[newName] = config.processors[oldName]
        delete config.processors[oldName]
        for (let step of config.pipeline ? config.pipeline: [])
            if (step.type === 'Processor' && step.name === oldName)
                step.name = newName
    }
}

export function mixerNamesOf(configOrMixers: Config | Mixers | null): string[] {
    if (configOrMixers === null) {
        return []
    }
    const mixers: Mixers | null = isConfig(configOrMixers) ? configOrMixers.mixers : configOrMixers
    if (mixers)
        return sortedAlphabetically(Object.keys(mixers))
    return []
}

export function newMixerName(mixers: Mixers | null): string {
    return newName('Unnamed Mixer ', mixerNamesOf(mixers))
}

export function removeMixer(config: Config, name: string) {
    delete config.mixers?.[name]
    const pipeline = config.pipeline
    if (pipeline)
        config.pipeline = pipeline.filter(step => step.type !== 'Mixer' || step.name !== name)
}

export function renameMixer(config: Config, oldName: string, newName: string) {
    if (mixerNamesOf(config).includes(newName))
        throw new Error(`Mixer '${newName}' already exists`)
    if (config.mixers) {
        config.mixers[newName] = config.mixers[oldName]
        delete config.mixers[oldName]
        for (let step of config.pipeline ? config.pipeline : [])
            if (step.type === 'Mixer' && step.name === oldName)
                step.name = newName

    }
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

/** Name for empty filter/mixer/processor slot */
export const EMPTY = ''

export function defaultFilterStep(config: Config): FilterStep {
    const filterNames = filterNamesOf(config)
    return {
        type: 'Filter',
        channel: 0,
        names: filterNames.length === 1 ? [filterNames[0]] : [EMPTY],
        description: null,
        bypassed: null
    }
}

export function defaultMixerStep(config: Config): MixerStep {
    const mixerNames = mixerNamesOf(config)
    return {
        type: 'Mixer',
        name: mixerNames.length === 1 ? mixerNames[0] : EMPTY,
        description: null,
        bypassed: null
    }
}

export function defaultProcessorStep(config: Config): ProcessorStep {
    const processorNames = processorNamesOf(config)
    return {
        type: 'Processor',
        name: processorNames.length === 1 ? processorNames[0] : EMPTY,
        description: null,
        bypassed: null
    }
}

export interface Config {
    devices: Devices,
    filters: Filters | null,
    mixers: Mixers | null,
    processors: Processors | null,
    pipeline: Pipeline | null,
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
    capture_samplerate: number | null,

    //Rate monitoring
    stop_on_rate_change: boolean | null,
    rate_measure_interval: number | null,

    //Volume control settings
    volume_ramp_time: number | null,

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
    | { type: 'CoreAudio', channels: number, format: Format | null, device: string | null }
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
    | { type: 'CoreAudio', channels: number, format: Format | null, device: string | null, exclusive: boolean | null }
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

export function maxChannelCount(config: Config, pipelineStepIndex: number): number {
    var lastValidMixerStepBeforeIndex = null
    if (config.pipeline) {
        lastValidMixerStepBeforeIndex = List(config.pipeline)
            .findLast((step, index) =>
                step.type === 'Mixer'
                && step.name !== ''
                && index < pipelineStepIndex
            ) as MixerStep | undefined
    }
    if (lastValidMixerStepBeforeIndex && config.mixers) {
        const mixer = config.mixers[lastValidMixerStepBeforeIndex.name]
        return mixer.channels.out
    }
    return config.devices.capture.channels
}

export function filterGain(config: Config, filterName: string): number | undefined {
    return config.filters?.[filterName]?.parameters?.gain
}

export function filterParameter(config: Config, filterName: string, param: string): number | undefined {
    const parameters = config.filters?.[filterName]?.parameters
    if (parameters !== undefined && parameters.hasOwnProperty(param))
        return parameters[param]
}

export function setFilterParameter(config: Config, filterName: string, param: string, value: number) {
    const parameters = config.filters?.[filterName]?.parameters
    if (parameters !== undefined && parameters.hasOwnProperty(param))
        parameters[param] = value
}