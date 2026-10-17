import { expect, test } from "vitest"
import { defaultConfig } from "./camilladsp/config"
import { buildPlaybackConfig } from "./playbacktab"

const PLAYBACK_MIXER_NAME = "__file_playback_adapter__"

function baseStereoAlsa() {
  const config = defaultConfig()
  config.devices.samplerate = 48000
  config.devices.capture = {
    type: "Alsa",
    channels: 2,
    format: null,
    device: "hw:0",
    stop_on_inactive: null,
    link_volume_control: null,
    link_mute_control: null,
    labels: null,
  }
  config.devices.resampler = null
  config.devices.capture_samplerate = null
  return config
}

test("buildPlaybackConfig replaces capture with WavFile (bare filename)", () => {
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "sweep.wav",
    samplerate: 48000,
    channels: 2,
  })
  expect(result.devices.capture).toEqual({
    type: "WavFile",
    filename: "sweep.wav",
    extra_samples: null,
    labels: null,
  })
})

test("buildPlaybackConfig: matching samplerate disables resampling", () => {
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "sweep.wav",
    samplerate: 48000,
    channels: 2,
  })
  expect(result.devices.resampler).toBeNull()
  expect(result.devices.capture_samplerate).toBeNull()
})

test("buildPlaybackConfig: differing samplerate enables Synchronous resampler", () => {
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "sweep.wav",
    samplerate: 96000,
    channels: 2,
  })
  expect(result.devices.resampler).toEqual({ type: "Synchronous" })
  expect(result.devices.capture_samplerate).toBe(96000)
})

test("buildPlaybackConfig: matching channel count inserts no mixer", () => {
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "sweep.wav",
    samplerate: 48000,
    channels: 2,
  })
  expect(result.mixers?.[PLAYBACK_MIXER_NAME]).toBeUndefined()
  expect(result.pipeline?.some((s) => s.type === "Mixer" && s.name === PLAYBACK_MIXER_NAME)).toBe(false)
})

test("buildPlaybackConfig: wav has fewer channels -> round-robin mixer", () => {
  // Mono wav into stereo capture: out 0 <- in 0, out 1 <- in 0
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "mono.wav",
    samplerate: 48000,
    channels: 1,
  })
  const mixer = result.mixers?.[PLAYBACK_MIXER_NAME]
  expect(mixer).toBeDefined()
  expect(mixer!.channels).toEqual({ in: 1, out: 2 })
  expect(mixer!.mapping).toEqual([
    { dest: 0, sources: [{ channel: 0, gain: null, scale: null, inverted: null, mute: null }], mute: null },
    { dest: 1, sources: [{ channel: 0, gain: null, scale: null, inverted: null, mute: null }], mute: null },
  ])
  expect(result.pipeline![0]).toEqual({
    type: "Mixer",
    name: PLAYBACK_MIXER_NAME,
    description: null,
    bypassed: null,
  })
})

test("buildPlaybackConfig: wav has more channels -> drop extras", () => {
  // 4ch wav into stereo capture: out 0 <- in 0, out 1 <- in 1
  const result = buildPlaybackConfig(baseStereoAlsa(), {
    filename: "quad.wav",
    samplerate: 48000,
    channels: 4,
  })
  const mixer = result.mixers?.[PLAYBACK_MIXER_NAME]
  expect(mixer).toBeDefined()
  expect(mixer!.channels).toEqual({ in: 4, out: 2 })
  expect(mixer!.mapping).toEqual([
    { dest: 0, sources: [{ channel: 0, gain: null, scale: null, inverted: null, mute: null }], mute: null },
    { dest: 1, sources: [{ channel: 1, gain: null, scale: null, inverted: null, mute: null }], mute: null },
  ])
})

test("buildPlaybackConfig: stale playback adapter is removed when channels match", () => {
  const config = baseStereoAlsa()
  if (!config.mixers) config.mixers = {}
  config.mixers[PLAYBACK_MIXER_NAME] = {
    description: "stale",
    channels: { in: 1, out: 2 },
    mapping: [],
    labels: null,
  }
  if (!config.pipeline) config.pipeline = []
  config.pipeline = [{ type: "Mixer", name: PLAYBACK_MIXER_NAME, description: null, bypassed: null }]
  const result = buildPlaybackConfig(config, {
    filename: "sweep.wav",
    samplerate: 48000,
    channels: 2,
  })
  expect(result.mixers?.[PLAYBACK_MIXER_NAME]).toBeUndefined()
  expect(result.pipeline!.some((s) => s.type === "Mixer" && s.name === PLAYBACK_MIXER_NAME)).toBe(false)
})

test("buildPlaybackConfig: original pipeline steps are preserved after the adapter", () => {
  const config = baseStereoAlsa()
  if (!config.pipeline) config.pipeline = []
  config.pipeline.push({
    type: "Filter",
    channels: [0],
    description: null,
    bypassed: null,
    names: ["myfilter"],
  })
  const result = buildPlaybackConfig(config, {
    filename: "mono.wav",
    samplerate: 48000,
    channels: 1,
  })
  expect(result.pipeline).toHaveLength(2)
  expect(result.pipeline![0].type).toBe("Mixer")
  expect(result.pipeline![1].type).toBe("Filter")
})

test("buildPlaybackConfig: does not mutate the input config", () => {
  const base = baseStereoAlsa()
  const before = JSON.stringify(base)
  buildPlaybackConfig(base, { filename: "sweep.wav", samplerate: 96000, channels: 1 })
  expect(JSON.stringify(base)).toBe(before)
})
