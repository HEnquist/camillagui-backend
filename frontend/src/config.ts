import {sortedAlphabetically} from "./common-tsx"

export function defaultConfig(): Config {
    return {
        devices: {
            samplerate: 48000,

            //Buffers
            chunksize: 1024,
            queuelimit: 4,

            //Silence
            silence_threshold: 0,
            silence_timeout: 0,

            //Rate adjust
            enable_rate_adjust: false,
            adjust_period: 3,
            target_level: 1024,

            //Resampler
            enable_resampling: true,
            resampler_type: 'FastAsync',
            capture_samplerate: 44100,

            capture: {type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0'},
            playback: {type: 'Alsa', channels: 2, format: 'S32LE', device: 'hw:0'},
        },
        filters: {},
        mixers: {},
        pipeline: [],
    }
}

export function filterNamesOf(configOrFilters: Config | Filters): string[] {
    const filters: Filters = isConfig(configOrFilters) ? configOrFilters.filters : configOrFilters
    return sortedAlphabetically(Object.keys(filters))
}

function isConfig(maybeConfig: Config | Filters | Mixers): maybeConfig is Config {
    return maybeConfig.devices !== undefined
}

export function newFilterName(filters: Filters): string {
    return newName('New Filter ', filterNamesOf(filters))
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
        parameters: {type: "Lowpass", q: 0.5, freq: 1000},
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
    return newName('New Mixer ', mixerNamesOf(mixers))
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
        channels: {in: 2, out: 2},
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
    return {channel: newChannel, gain: 0, inverted: false, mute: false}
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
    queuelimit: number,

    //Silence
    silence_threshold: number,
    silence_timeout: number,

    //Rate adjust
    enable_rate_adjust: boolean,
    adjust_period: number,
    target_level: number,

    //Resampler
    enable_resampling: boolean,
    resampler_type: ResamplerType,
    capture_samplerate: number,

    capture: CaptureDevice,
    playback: PlaybackDevice,
}

export type ResamplerType = 'FastAsync' | 'BalancedAsync' | 'AccurateAsync' | 'Synchronous'
export const ResamplerTypes: ResamplerType[] = ["FastAsync", "BalancedAsync", "AccurateAsync", "Synchronous"]

export type CaptureDevice =
    { type: 'Alsa' | 'CoreAudio' | 'Pulse' | 'Wasapi', channels: number, format: Format, device: string }
    | { type: 'File', channels: number, format: Format, filename: '/path/to/file',
        extra_samples: number, skip_bytes: number, read_bytes: number }
    | { type: 'Stdin', channels: number, format: Format,
        extra_samples: number, skip_bytes: number, read_bytes: number }

export type PlaybackDevice =
    { type: 'Alsa' | 'CoreAudio' | 'Pulse' | 'Wasapi', channels: number, format: Format, device: string }
    | { type: 'File', channels: number, format: Format, filename: string}
    | { type: 'Stdout', channels: number, format: Format }

export type Format = 'S16LE' | 'S24LE' | 'S24LE3' | 'S32LE' | 'FLOAT32LE' | 'FLOAT64LE'
export const Formats: Format[] = ['S16LE', 'S24LE', 'S24LE3', 'S32LE', 'FLOAT32LE', 'FLOAT64LE']

export interface Filters {
    [name: string] : Filter
}
export interface Filter {
    type: string
    parameters: { [name: string]: any }
}

export type Mixers = {
    [name: string] : Mixer
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
