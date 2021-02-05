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
            resampler_type: "FastAsync",
            capture_samplerate: 44100,

            capture: {type: "Alsa", channels: 2, format: "S32LE", device: "hw:0"},
            playback: {type: "Alsa", channels: 2, format: "S32LE", device: "hw:0"},
        },
        filters: {},
        mixers: {},
        pipeline: [],
    };
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
    resampler_type: 'FastAsync' | 'BalancedAsync' | 'AccurateAsync' | 'Synchronous',
    capture_samplerate: number,

    capture: CaptureDevice,
    playback: PlaybackDevice,
}

export type CaptureDevice = any
export type PlaybackDevice = any

export type Filters = any
export type Mixers = any
export type Pipeline = any