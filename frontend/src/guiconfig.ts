import type { Schemas } from "./api/client"

/** The GUI settings, from `/api/guiconfig`. */
export type GuiConfig = Schemas["GuiConfig"]

export type CaptureType =
  | "Alsa"
  | "Asio"
  | "Wasapi"
  | "CoreAudio"
  | "PipeWire"
  | "RawFile"
  | "WavFile"
  | "Stdin"
  | "SignalGenerator"

export type PlaybackType = "Alsa" | "Asio" | "Wasapi" | "CoreAudio" | "PipeWire" | "File" | "Stdout"

export type ShortcutSection = Schemas["ShortcutSection"]

export type Shortcut = Schemas["Shortcut"]

export type ConfigElement = Schemas["ConfigElement"]

/** What the GUI uses until the backend has sent its settings. */
export function defaultGuiConfig(): GuiConfig {
  return {
    hide_capture_samplerate: false,
    hide_silence: false,
    hide_capture_device: false,
    hide_playback_device: false,
    hide_rate_monitoring: false,
    hide_multithreading: false,
    coeff_dir: "",
    supported_capture_types: null,
    supported_playback_types: null,
    apply_config_automatically: false,
    save_config_automatically: false,
    status_update_interval: 500,
    can_update_active_config: false,
    custom_shortcuts: [],
    volume_max: 0,
    volume_range: 50,
    page_title: "CamillaDSP",
    spectrum_min_freq: 20,
    spectrum_max_freq: 20000,
    spectrum_n_bins: 100,
    spectrum_min_db: -100,
    spectrum_max_db: 0,
    spectrum_max_rate: 30,
    audiofiles_supported: false,
    allow_absolute_paths: false,
  }
}
