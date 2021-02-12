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
    };
}


export function filterNamesOf(config: Config): string[] {
    return config.filters ? Object.keys(config.filters) : []
}

export function mixerNamesOf(config: Config): string[] {
    return config.mixers ? Object.keys(config.mixers) : []
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

export type Filters = any
export type Mixers = any
export type Pipeline = any