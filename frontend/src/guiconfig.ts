export interface GuiConfig {
    hide_capture_samplerate: boolean
    hide_silence: boolean
    hide_capture_device: boolean
    hide_playback_device: boolean
    hide_rate_monitoring: boolean
    coeff_dir: string
    supported_capture_types?: CaptureType[]
    supported_playback_types?: PlaybackType[]
    apply_config_automatically: boolean
    save_config_automatically: boolean
    status_update_interval: number
    can_update_active_config: boolean
    custom_shortcuts: ShortcutSection[]
}

export type CaptureType = 'Alsa' | 'Wasapi' | 'Jack' | 'CoreAudio' | 'Pulse' | 'RawFile' | 'WavFile' | 'Stdin' | 'Bluez'

export type PlaybackType = 'Alsa' | 'Wasapi' | 'Jack' | 'CoreAudio' | 'Pulse' | 'File' | 'Stdout'

export interface ShortcutSection {
    section: string
    description?: string
    shortcuts: Shortcut[]
}

export interface Shortcut {
    name: string
    description?: string
    config_elements: ConfigElement[]
    range_from?: number
    range_to?: number
    step?: number
    type?: string
}

export interface ConfigElement {
    path: string[]
    reverse?: boolean
}


export function defaultGuiConfig(): GuiConfig {
    return {
        hide_capture_samplerate: false,
        hide_silence: false,
        hide_capture_device: false,
        hide_playback_device: false,
        hide_rate_monitoring: false,
        coeff_dir: '',
        apply_config_automatically: false,
        save_config_automatically: false,
        status_update_interval: 100,
        can_update_active_config: false,
        custom_shortcuts: []
    }
}