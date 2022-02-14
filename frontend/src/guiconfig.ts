export interface GuiConfig {
    hide_capture_samplerate: boolean
    hide_silence: boolean
    hide_capture_device: boolean
    hide_playback_device: boolean
    hide_rate_monitoring: boolean
    coeff_dir: string
    supported_capture_types?: CaptureType[]
    supported_playback_types?: PlaybackType[]
}

export type CaptureType = 'Alsa' | 'Wasapi' | 'Jack' | 'CoreAudio' | 'Pulse' | 'File' | 'Stdin'

export type PlaybackType = 'Alsa' | 'Wasapi' | 'Jack' | 'CoreAudio' | 'Pulse' | 'File' | 'Stdout'

export function defaultGuiConfig(): GuiConfig {
    return {
        hide_capture_samplerate: false,
        hide_silence: false,
        hide_capture_device: false,
        hide_playback_device: false,
        hide_rate_monitoring: false,
        coeff_dir: ''
    }
}