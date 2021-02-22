export interface GuiConfig {
    hide_capture_samplerate: boolean
    hide_silence: boolean
    hide_capture_device: boolean
    hide_playback_device: boolean
    coeff_dir: string
}

export function defaultGuiConfig(): GuiConfig {
    return {
        hide_capture_samplerate: false,
        hide_silence: false,
        hide_capture_device: false,
        hide_playback_device: false,
        coeff_dir: ''
    }
}