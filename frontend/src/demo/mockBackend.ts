import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Schemas } from "../api/client"
import { completeConfig, Config, defaultConfig } from "../camilladsp/config"
import { LevelsEvent, SpectrumEvent, SpectrumSubscriptionParams, StateEvent } from "../camilladsp/status"
import { defaultGuiConfig, GuiConfig } from "../guiconfig"
import { download } from "../utilities/files"

type FileInfo = Schemas["FileInfo"]

type DemoAudioFile = {
  last_modified: number
  size: number
  samplerate?: number
  channels?: number
  sampleformat?: string
  duration?: number
}

type DemoState = {
  volume: number
  mute: boolean
  faders: Array<{ volume: number; mute: boolean }>
  currentConfig: Config
  activeConfigFileName: string | null
  storedConfigs: Record<string, Config>
  storedConfigMeta: Record<string, { last_modified: number }>
  storedCoeffs: Record<string, { last_modified: number; size: number; content: string }>
  storedAudioFiles: Record<string, DemoAudioFile>
  guiConfig: GuiConfig
  processingStopped: boolean
  logLines: string[]
}

const ENABLE_DEMO_BACKEND = import.meta.env.VITE_ENABLE_DEMO_BACKEND === "true"
const STORAGE_KEY = "camillagui.demo.state.v2"
const LEVEL_INTERVAL_MS = 140

let spectrumShape = { offset: -38, slope: -3 }
const MAIN_CONFIG_NAME = "living-room-demo.yml"
const CURRENT_CONFIG_VERSION = 4
const DEMO_AUDIOFILES_PREFIX = "/demo/audiofiles/"
const DEMO_COEFF_PREFIX = "/demo/coeffs/"

function demoStripAudioPaths(config: Config): Config {
  const c = structuredClone(config)
  const cap = c.devices?.capture as { type?: string; filename?: string }
  if (cap?.type === "WavFile" || cap?.type === "RawFile") {
    cap.filename = demoBareName(cap.filename ?? "", DEMO_AUDIOFILES_PREFIX)
  }
  const pb = c.devices?.playback as { type?: string; filename?: string }
  if (pb?.type === "File") {
    pb.filename = demoBareName(pb.filename ?? "", DEMO_AUDIOFILES_PREFIX)
  }
  return c
}

function demoResolveAudioPaths(config: Config): Config {
  const c = structuredClone(config)
  const cap = c.devices?.capture as { type?: string; filename?: string }
  if (cap?.type === "WavFile" || cap?.type === "RawFile") {
    cap.filename = demoAbsoluteName(cap.filename ?? "", DEMO_AUDIOFILES_PREFIX)
  }
  const pb = c.devices?.playback as { type?: string; filename?: string }
  if (pb?.type === "File") {
    pb.filename = demoAbsoluteName(pb.filename ?? "", DEMO_AUDIOFILES_PREFIX)
  }
  return c
}

function demoBareName(path: string, prefix: string): string {
  if (path.startsWith(prefix)) return path.slice(prefix.length)
  const slash = path.lastIndexOf("/")
  return slash >= 0 ? path.slice(slash + 1) : path
}

function demoAbsoluteName(filename: string, prefix: string): string {
  if (filename.startsWith("/")) return filename
  return prefix + filename
}

function demoPathsAreValid(config: Config): string[] {
  if (state.guiConfig.allow_absolute_paths) return []
  const offenders: string[] = []
  const check = (path: string | undefined, prefix: string) => {
    if (path && path.startsWith("/") && !path.startsWith(prefix)) offenders.push(path)
  }
  const cap = config.devices?.capture as { type?: string; filename?: string }
  if (cap?.type === "WavFile" || cap?.type === "RawFile") check(cap.filename, DEMO_AUDIOFILES_PREFIX)
  const pb = config.devices?.playback as { type?: string; filename?: string }
  if (pb?.type === "File") check(pb.filename, DEMO_AUDIOFILES_PREFIX)
  const filters =
    (
      config as unknown as {
        filters?: Record<string, { type?: string; parameters?: { type?: string; filename?: string } }>
      }
    ).filters ?? {}
  for (const f of Object.values(filters)) {
    if (f.type === "Conv" && (f.parameters?.type === "Raw" || f.parameters?.type === "Wav")) {
      check(f.parameters?.filename, DEMO_COEFF_PREFIX)
    }
  }
  return offenders
}

const BACKENDS = {
  playback: ["Alsa", "CoreAudio", "Wasapi", "PipeWire", "File", "Stdout"],
  capture: ["Alsa", "CoreAudio", "Wasapi", "PipeWire", "Stdin", "RawFile", "WavFile", "SignalGenerator"],
} as const

const DEVICE_OPTIONS: Record<string, [string, string][]> = {
  Alsa: [
    ["hw:0", "Built-in Audio"],
    ["hw:1", "USB DAC"],
    ["hw:Loopback", "Loopback Interface"],
    ["Busy Device", "Busy Device"],
  ],
  CoreAudio: [
    ["MacBook Pro Speakers", "MacBook Pro Speakers"],
    ["Scarlett 2i2 USB", "Scarlett 2i2 USB"],
    ["BlackHole 16ch", "BlackHole 16ch"],
    ["Busy Device", "Busy Device"],
  ],
  Wasapi: [
    ["Primary Sound Driver", "Primary Sound Driver"],
    ["USB Audio Device", "USB Audio Device"],
    ["Busy Device", "Busy Device"],
  ],
}

function demoFormatsForBackend(backend: string): string[] {
  if (backend === "CoreAudio" || backend === "Wasapi") {
    return ["S16", "S32", "F32"]
  }
  return ["S16_LE", "S32_LE", "F32_LE"]
}

function demoHighRateSamplerates(formats: string[]) {
  return [88200, 96000, 176400, 192000].map((samplerate) => ({
    samplerate,
    formats: formats.slice(1),
  }))
}

function isSixteenChannelDemoDevice(device: string) {
  return device === "BlackHole 16ch" || device === "hw:Loopback"
}

function isBusyDemoDevice(device: string) {
  return device === "Busy Device"
}

function demoDeviceOptionsForBackend(backend: string): [string, string][] {
  return DEVICE_OPTIONS[backend] ?? [["default", `${backend} demo device`]]
}

function isKnownDemoDevice(backend: string, device: string) {
  return demoDeviceOptionsForBackend(backend).some(([name]) => name === device)
}

let installed = false
const nativeFetch = globalThis.fetch.bind(globalThis)
const NativeEventSource = globalThis.EventSource
// Not there outside a browser, as in the tests.
const nativeSubmit: (() => void) | undefined = globalThis.HTMLFormElement?.prototype.submit

function createSampleConfig(): Config {
  const config = defaultConfig()
  config.title = "Living room demo"
  config.description = "Static demo backend with persisted controls and synthetic metering"
  config.devices.capture = {
    type: "CoreAudio",
    channels: 2,
    format: null,
    device: "Scarlett 2i2 USB",
    labels: ["Left", "Right"],
  }
  config.devices.playback = {
    type: "CoreAudio",
    channels: 2,
    format: null,
    device: "MacBook Pro Speakers",
    exclusive: null,
  }
  return config
}

function createGuiConfig(): GuiConfig {
  return {
    ...defaultGuiConfig(),
    can_update_active_config: true,
    coeff_dir: "/demo/coeffs",
    page_title: "CamillaGUI Demo",
    supported_capture_types: [...BACKENDS.capture],
    supported_playback_types: [...BACKENDS.playback],
    spectrum_n_bins: 60,
    spectrum_max_rate: 10,
    audiofiles_supported: true,
    allow_absolute_paths: false,
  }
}

function defaultStoredAudioFiles(): Record<string, DemoAudioFile> {
  const now = Math.floor(Date.now() / 1000)
  const sizeForWav = (samplerate: number, channels: number, bytesPerSample: number, seconds: number) =>
    Math.round(samplerate * channels * bytesPerSample * seconds) + 44
  return {
    "REW_sweep_48k_20s.wav": {
      last_modified: now - 3600,
      duration: 20.0,
      samplerate: 48000,
      channels: 2,
      sampleformat: "F32_LE",
      size: sizeForWav(48000, 2, 4, 20.0),
    },
    "REW_sweep_96k_30s.wav": {
      last_modified: now - 7200,
      duration: 30.0,
      samplerate: 96000,
      channels: 2,
      sampleformat: "S24_3_LE",
      size: sizeForWav(96000, 2, 3, 30.0),
    },
    "REW_sweep_mono_48k_10s.wav": {
      last_modified: now - 18000,
      duration: 10.0,
      samplerate: 48000,
      channels: 1,
      sampleformat: "S16_LE",
      size: sizeForWav(48000, 1, 2, 10.0),
    },
    "pink_noise_60s.wav": {
      last_modified: now - 86400,
      duration: 60.0,
      samplerate: 48000,
      channels: 2,
      sampleformat: "S24_3_LE",
      size: sizeForWav(48000, 2, 3, 60.0),
    },
    "white_noise_44k1_120s.wav": {
      last_modified: now - 172800,
      duration: 120.0,
      samplerate: 44100,
      channels: 2,
      sampleformat: "S16_LE",
      size: sizeForWav(44100, 2, 2, 120.0),
    },
    "raw_capture_48k_stereo.raw": {
      last_modified: now - 259200,
      size: 48000 * 2 * 4 * 10,
    },
  }
}

function defaultState(): DemoState {
  const sampleConfig = createSampleConfig()
  return {
    volume: -18,
    mute: false,
    faders: [
      { volume: -18, mute: false },
      { volume: -6, mute: false },
      { volume: -12, mute: false },
      { volume: -9, mute: false },
      { volume: -15, mute: false },
    ],
    currentConfig: sampleConfig,
    activeConfigFileName: MAIN_CONFIG_NAME,
    storedConfigs: {
      [MAIN_CONFIG_NAME]: structuredClone(sampleConfig),
      "headphones-demo.yml": {
        ...structuredClone(sampleConfig),
        title: "Headphones demo",
        description: "Alternative demo preset",
      },
    },
    storedConfigMeta: {
      [MAIN_CONFIG_NAME]: { last_modified: Math.floor(Date.now() / 1000) - 3600 },
      "headphones-demo.yml": { last_modified: Math.floor(Date.now() / 1000) - 7200 },
    },
    storedCoeffs: {
      "demo-room.wav": {
        last_modified: Math.floor(Date.now() / 1000) - 14400,
        size: 524288,
        content: "demo coeff content",
      },
      "demo-target.raw": {
        last_modified: Math.floor(Date.now() / 1000) - 28800,
        size: 262144,
        content: "demo raw coeff content",
      },
    },
    storedAudioFiles: defaultStoredAudioFiles(),
    guiConfig: createGuiConfig(),
    processingStopped: false,
    logLines: ["[demo] CamillaGUI mock backend initialized", "[demo] Static mode enabled for GitHub Pages deployment"],
  }
}

function loadState(): DemoState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<DemoState>
    return {
      ...defaultState(),
      ...parsed,
      currentConfig: parsed.currentConfig ?? defaultState().currentConfig,
      storedConfigs: parsed.storedConfigs ?? defaultState().storedConfigs,
      storedConfigMeta: parsed.storedConfigMeta ?? defaultState().storedConfigMeta,
      storedCoeffs: parsed.storedCoeffs ?? defaultState().storedCoeffs,
      storedAudioFiles: { ...defaultStoredAudioFiles(), ...(parsed.storedAudioFiles ?? {}) },
      guiConfig: createGuiConfig(),
      logLines: parsed.logLines ?? defaultState().logLines,
      faders: parsed.faders ?? defaultState().faders,
    }
  } catch {
    return defaultState()
  }
}

const state = loadState()

function persistState() {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
}

function appendLog(message: string) {
  state.logLines = [...state.logLines.slice(-199), `[demo] ${message}`]
  persistState()
}

function touchConfigFile(name: string) {
  state.storedConfigMeta[name] = { last_modified: Math.floor(Date.now() / 1000) }
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  })
}

function textResponse(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  })
}

function blobResponse(blob: Blob, headers?: HeadersInit) {
  return new Response(blob, { status: 200, headers })
}

function fileDownloadResponse(type: "config" | "coeff", filename: string) {
  if (type === "config") {
    const config = state.storedConfigs[filename]
    if (!config) {
      return textResponse("Config file not found", 404)
    }
    return blobResponse(new Blob([stringifyYaml(config)], { type: "application/x-yaml;charset=utf-8" }), {
      "Content-Type": "application/x-yaml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    })
  }

  const coeff = state.storedCoeffs[filename]
  if (!coeff) {
    return textResponse("Coeff file not found", 404)
  }
  return blobResponse(new Blob([coeff.content], { type: "application/octet-stream" }), {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
  })
}

function resolveUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") {
    return new URL(input, globalThis.location.origin)
  }
  if (input instanceof URL) {
    return new URL(input.toString(), globalThis.location.origin)
  }
  return new URL(input.url, globalThis.location.origin)
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase()
  return "GET"
}

async function requestText(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body
  if (typeof Request !== "undefined" && input instanceof Request) return input.text()
  if (init?.body instanceof Blob) return init.body.text()
  return ""
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const text = await requestText(input, init)
  return JSON.parse(text) as T
}

async function requestFormData(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.body instanceof FormData) return init.body
  if (typeof Request !== "undefined" && input instanceof Request) return input.formData()
  return new FormData()
}

function currentCaptureLabels() {
  const labels = state.currentConfig.devices.capture.labels
  const channels = captureChannelCount(state.currentConfig)
  if (labels && labels.length === channels) return labels
  return Array.from({ length: channels }, (_, index) => `In ${index + 1}`)
}

function currentPlaybackLabels() {
  const channels = state.currentConfig.devices.playback.channels
  return Array.from({ length: channels }, (_, index) => `Out ${index + 1}`)
}

function captureChannelCount(config: Config) {
  return "channels" in config.devices.capture ? config.devices.capture.channels : 2
}

/**
 * A synthetic impulse response for demo mode.
 *
 * Filter evaluation now runs in the browser, so the demo backend only has to
 * supply what a real one would: the coefficients behind a Conv filter that
 * reads a file. The GUI does the FFT and plots the real response of these.
 */
/**
 * The same framing the real backend uses for a coefficient reply: a little
 * endian uint32 header length, that much JSON, padding to a multiple of 8, and
 * the samples as raw float64. See `_coefficients_response` in the backend and
 * `unframeCoefficients` in camilladsp/eval.
 */
function coefficientsResponse(options: Schemas["FilterOption"][], coefficients: number[]): Response {
  // float32, as the real backend sends for a wav or raw file of that width
  const coeffsHeader: Schemas["CoeffsHeader"] = { options, format: "float32" }
  const header = new TextEncoder().encode(JSON.stringify(coeffsHeader))
  const padding = (8 - ((4 + header.length) % 8)) % 8
  const start = 4 + header.length + padding
  const buffer = new ArrayBuffer(start + 4 * coefficients.length)
  new DataView(buffer).setUint32(0, header.length, true)
  new Uint8Array(buffer, 4, header.length).set(header)
  new Float32Array(buffer, start).set(coefficients)
  return new Response(buffer, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  })
}

function makeConvCoefficients(filename: string) {
  const taps = 512
  const nameHash = Array.from(filename).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const center = 96
  const cutoff = 0.15 + (nameHash % 17) / 100
  const coefficients = Array.from({ length: taps }, (_, index) => {
    const n = index - center
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n)
    // Hann window over the part of the response that carries the impulse
    const window = index < 2 * center ? 0.5 - 0.5 * Math.cos((Math.PI * index) / center) : 0
    return sinc * window
  })
  return {
    options: [
      { name: "48000 Hz - 2 Channels", samplerate: 48000, channels: 2 },
      { name: "96000 Hz - 2 Channels", samplerate: 96000, channels: 2 },
      { name: "48000 Hz - 4 Channels", samplerate: 48000, channels: 4 },
    ],
    coefficients,
  }
}

function makeConfigFileInfo(name: string, config: Config): FileInfo {
  const meta = state.storedConfigMeta[name] ?? { last_modified: Math.floor(Date.now() / 1000) }
  return {
    name,
    last_modified: meta.last_modified,
    size: JSON.stringify(config).length,
    title: config.title ?? undefined,
    description: config.description ?? undefined,
    version: CURRENT_CONFIG_VERSION,
    valid: true,
  }
}

function makeCoeffFileInfo(name: string): FileInfo {
  const coeff = state.storedCoeffs[name]
  return {
    name,
    last_modified: coeff.last_modified,
    size: coeff.size,
  }
}

function makeAudioFileInfo(name: string): FileInfo {
  const f = state.storedAudioFiles[name]
  const isWav = name.toLowerCase().endsWith(".wav")
  if (!isWav) return { name, last_modified: f.last_modified, size: f.size }
  return {
    name,
    last_modified: f.last_modified,
    size: f.size,
    valid: true,
    samplerate: f.samplerate,
    channels: f.channels,
    sampleformat: f.sampleformat,
    duration: f.duration,
  }
}

/** The demo's files of a kind, by name. */
function demoFiles(kind: Schemas["FileKind"]): Record<string, unknown> {
  if (kind === "config") return state.storedConfigs
  if (kind === "coeff") return state.storedCoeffs
  return state.storedAudioFiles
}

function listDemoFiles(kind: Schemas["FileKind"]): FileInfo[] {
  if (kind === "config")
    return Object.entries(state.storedConfigs).map(([name, config]) => makeConfigFileInfo(name, config))
  if (kind === "coeff") return Object.keys(state.storedCoeffs).map((name) => makeCoeffFileInfo(name))
  return Object.keys(state.storedAudioFiles).map((name) => makeAudioFileInfo(name))
}

async function storeDemoFile(kind: Schemas["FileKind"], file: File) {
  const last_modified = Math.floor(Date.now() / 1000)
  if (kind === "config") {
    const content = await file.text()
    try {
      const parsed = content.trim().startsWith("{") ? JSON.parse(content) : parseYaml(content)
      state.storedConfigs[file.name] = parsed && typeof parsed === "object" ? (parsed as Config) : createSampleConfig()
    } catch {
      state.storedConfigs[file.name] = createSampleConfig()
    }
    touchConfigFile(file.name)
  } else if (kind === "coeff") {
    state.storedCoeffs[file.name] = { last_modified, size: file.size, content: await file.text() }
  } else if (file.name.toLowerCase().endsWith(".wav")) {
    state.storedAudioFiles[file.name] = {
      last_modified,
      size: file.size,
      samplerate: 48000,
      channels: 2,
      sampleformat: "F32_LE",
      duration: 0,
    }
  } else {
    state.storedAudioFiles[file.name] = { last_modified, size: file.size }
  }
}

function deleteDemoFile(kind: Schemas["FileKind"], name: string) {
  delete demoFiles(kind)[name]
  if (kind === "config") {
    delete state.storedConfigMeta[name]
    if (state.activeConfigFileName === name) state.activeConfigFileName = null
  }
}

function renameDemoFile(kind: Schemas["FileKind"], source: string, target: string) {
  const files = demoFiles(kind)
  files[target] = files[source]
  delete files[source]
  if (kind === "config") {
    state.storedConfigMeta[target] = state.storedConfigMeta[source] ?? { last_modified: Math.floor(Date.now() / 1000) }
    delete state.storedConfigMeta[source]
    if (state.activeConfigFileName === source) state.activeConfigFileName = target
  }
}

/** Not a zip, just a readable stand-in for one. */
function demoZipContent(kind: Schemas["FileKind"], names: string[]): string {
  if (kind === "config") {
    const configs = names.filter((name) => state.storedConfigs[name]).map((name) => [name, state.storedConfigs[name]])
    return JSON.stringify(Object.fromEntries(configs), null, 2)
  }
  if (kind === "coeff") {
    return names
      .filter((name) => state.storedCoeffs[name])
      .map((name) => `${name}\n${state.storedCoeffs[name].content}`)
      .join("\n\n")
  }
  return names
    .filter((name) => state.storedAudioFiles[name])
    .map((name) => `${name} (${state.storedAudioFiles[name].size} bytes, demo placeholder)`)
    .join("\n")
}

function cloneConfig(config: Config) {
  return structuredClone(config)
}

function errorResponse(message: string, status: number) {
  const body: Schemas["ErrorBody"] = { message }
  return jsonResponse(body, status)
}

function noContent() {
  return new Response(null, { status: 204 })
}

/** Set a fader, 0 being the main volume. */
function setFader(index: number, change: Partial<Schemas["Fader"]>) {
  const target = state.faders[index]
  if (!target) return errorResponse("Invalid fader index", 400)
  Object.assign(target, change)
  if (index === 0) {
    state.volume = target.volume
    state.mute = target.mute
  }
  const name = index === 0 ? "main" : `aux fader ${index}`
  if (change.volume !== undefined) appendLog(`${name} volume set to ${target.volume.toFixed(1)} dB`)
  if (change.mute !== undefined) appendLog(`${name} mute set to ${target.mute}`)
  persistState()
  return noContent()
}

/** The index in a `/api/param/faders/{index}/...` path. */
function faderIndex(pathname: string) {
  return Number(pathname.split("/")[4])
}

/** What the import endpoints send: the sections there are, with the optional fields filled in. */
function demoFragment(filters: Record<string, Schemas["Filter"]>): Schemas["ConfigFragment"] {
  return { filters }
}

function makeWavInfo(): Schemas["WavInfo"] {
  return {
    dataoffset: 44,
    datalength: 524288,
    sampleformat: "F32_LE",
    bitspersample: 32,
    channels: 2,
    byterate: 384000,
    samplerate: 48000,
    bytesperframe: 8,
  }
}

async function handleApiRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = resolveUrl(input)
  const method = requestMethod(input, init)
  const pathname = url.pathname

  if (pathname === "/api/guiconfig" && method === "GET") {
    return jsonResponse(state.guiConfig)
  }

  if (pathname === "/api/getstartconfig" && method === "GET") {
    const activeName = state.activeConfigFileName
    const config = activeName && state.storedConfigs[activeName] ? state.storedConfigs[activeName] : state.currentConfig
    state.currentConfig = cloneConfig(config)
    persistState()
    const startConfig: Schemas["StartConfig"] = {
      config_file_name: activeName,
      config: demoStripAudioPaths(cloneConfig(config)),
      source: activeName ? "active" : "dsp",
    }
    return jsonResponse(startConfig)
  }

  if (pathname === "/api/getactiveconfigfilename" && method === "GET") {
    const active: Schemas["ActiveConfigFile"] = { config_file_name: state.activeConfigFileName }
    return jsonResponse(active)
  }

  if (pathname === "/api/getconfig" && method === "GET") {
    return jsonResponse(demoStripAudioPaths(cloneConfig(state.currentConfig)))
  }

  if (pathname === "/api/setconfig" && method === "POST") {
    const { config } = await requestJson<Schemas["ConfigBody"]>(input, init)
    const offenders = demoPathsAreValid(completeConfig(config))
    if (offenders.length > 0) {
      return errorResponse(
        `Paths outside configured directories: ${offenders.join(", ")}. Set allow_absolute_paths: true to allow this.`,
        403,
      )
    }
    state.currentConfig = cloneConfig(completeConfig(config))
    state.processingStopped = false
    appendLog("applied config")
    persistState()
    return noContent()
  }

  if (pathname === "/api/saveconfigfile" && method === "POST") {
    const payload = await requestJson<Schemas["SaveConfigBody"]>(input, init)
    const config = completeConfig(payload.config)
    const offenders = demoPathsAreValid(config)
    if (offenders.length > 0) {
      return errorResponse(
        `Paths outside configured directories: ${offenders.join(", ")}. Set allow_absolute_paths: true to allow this.`,
        403,
      )
    }
    const configToStore = demoResolveAudioPaths(cloneConfig(config))
    state.currentConfig = cloneConfig(config)
    state.storedConfigs[payload.filename] = configToStore
    state.activeConfigFileName = payload.filename
    touchConfigFile(payload.filename)
    appendLog(`saved config ${payload.filename}`)
    persistState()
    return noContent()
  }

  if (pathname === "/api/getconfigfile" && method === "GET") {
    const name = url.searchParams.get("name")
    if (!name || !state.storedConfigs[name]) return errorResponse(`Config file '${name}' not found.`, 404)
    return jsonResponse(demoStripAudioPaths(cloneConfig(state.storedConfigs[name])))
  }

  if (pathname === "/api/getdefaultconfigfile" && method === "GET") {
    return jsonResponse(createSampleConfig())
  }

  if (pathname === "/api/setactiveconfigfile" && method === "POST") {
    const { name } = await requestJson<Schemas["ActiveConfigBody"]>(input, init)
    if (!state.storedConfigs[name]) return errorResponse(`Config file '${name}' not found.`, 404)
    state.activeConfigFileName = name
    state.currentConfig = cloneConfig(state.storedConfigs[name])
    appendLog(`activated config ${name}`)
    persistState()
    return noContent()
  }

  if (pathname === "/api/status" && method === "GET") {
    const labels = {
      capture: currentCaptureLabels(),
      playback: currentPlaybackLabels(),
    }
    const processingRunning = !state.processingStopped
    const status: Schemas["Status"] = {
      cdsp_online: true,
      capturerate: processingRunning ? 47999 + Math.round(Math.sin(Date.now() / 5000) * 3) : null,
      rateadjust: processingRunning ? Number((Math.sin(Date.now() / 1800) * 0.08).toFixed(3)) : null,
      bufferlevel: processingRunning ? 22 + Math.round((Math.sin(Date.now() / 1200) + 1) * 18) : null,
      clippedsamples: 0,
      processingload: processingRunning
        ? Number((18 + Math.sin(Date.now() / 900) * 6 + Math.random() * 3).toFixed(1))
        : null,
      resamplerload: processingRunning
        ? Number((6 + Math.sin(Date.now() / 1100) * 2 + Math.random() * 1.5).toFixed(1))
        : null,
      cdsp_version: "demo-3.0.0",
      backend_version: "demo-backend",
      labels,
      title: state.currentConfig.title,
      description: state.currentConfig.description,
    }
    return jsonResponse(status)
  }

  if (pathname === "/api/param/volume" && method === "GET") {
    return jsonResponse(state.volume)
  }

  if (pathname === "/api/param/volume" && method === "POST") {
    return setFader(0, { volume: await requestJson<number>(input, init) })
  }

  if (pathname === "/api/param/mute" && method === "GET") {
    return jsonResponse(state.mute)
  }

  if (pathname === "/api/param/mute" && method === "POST") {
    return setFader(0, { mute: await requestJson<boolean>(input, init) })
  }

  if (pathname === "/api/param/faders" && method === "GET") {
    const faders: Schemas["Fader"][] = state.faders
    return jsonResponse(faders)
  }

  if (/^\/api\/param\/faders\/\d+\/volume$/.test(pathname) && method === "POST") {
    return setFader(faderIndex(pathname), { volume: await requestJson<number>(input, init) })
  }

  if (/^\/api\/param\/faders\/\d+\/mute$/.test(pathname) && method === "POST") {
    return setFader(faderIndex(pathname), { mute: await requestJson<boolean>(input, init) })
  }

  if (pathname === "/api/stop" && method === "POST") {
    state.processingStopped = true
    appendLog("processing stopped")
    persistState()
    return noContent()
  }

  if (pathname === "/api/validateconfig" && method === "POST") {
    const issues: Schemas["ValidationIssue"][] = []
    return jsonResponse(issues)
  }

  if (pathname === "/api/convcoeffs" && method === "POST") {
    const { parameters } = await requestJson<Schemas["CoeffsRequest"]>(input, init)
    const filename = "filename" in parameters ? parameters.filename : "demo"
    const { options, coefficients } = makeConvCoefficients(filename)
    return coefficientsResponse(options, coefficients)
  }

  if (pathname === "/api/wavinfo" && method === "GET") {
    return jsonResponse(makeWavInfo())
  }

  if (pathname === "/api/defaultsforcoeffs" && method === "GET") {
    const filename = url.searchParams.get("file") ?? ""
    const defaults: Schemas["CoeffDefaults"] = filename.toLowerCase().endsWith(".wav")
      ? { type: "Wav" }
      : { type: "Raw", format: "F32_LE", skip_bytes_lines: 0, read_bytes_lines: 0 }
    return jsonResponse(defaults)
  }

  const filesRequest = /^\/api\/files\/(config|coeff|audiofile)(?:\/(upload|delete|rename|zip))?$/.exec(pathname)
  if (filesRequest) {
    const kind = filesRequest[1] as Schemas["FileKind"]
    const action = filesRequest[2]
    if (action === undefined && method === "GET") return jsonResponse(listDemoFiles(kind))
    if (action === "upload" && method === "POST") {
      const formData = await requestFormData(input, init)
      const files = formData.getAll("files").filter((value) => value instanceof File)
      for (const file of files) await storeDemoFile(kind, file)
      appendLog(`uploaded ${files.length} ${kind} file(s)`)
      persistState()
      return noContent()
    }
    if (action === "delete" && method === "POST") {
      const { names } = await requestJson<Schemas["FileNames"]>(input, init)
      names.forEach((name) => deleteDemoFile(kind, name))
      appendLog(`deleted ${names.length} ${kind} file(s)`)
      persistState()
      return noContent()
    }
    if (action === "rename" && method === "POST") {
      const { source, target } = await requestJson<Schemas["RenameBody"]>(input, init)
      const files = demoFiles(kind)
      if (!files[source]) return errorResponse(`File ${source} not found`, 400)
      if (files[target]) return errorResponse(`File ${target} already exists`, 400)
      renameDemoFile(kind, source, target)
      appendLog(`renamed ${kind} ${source} to ${target}`)
      persistState()
      return noContent()
    }
    if (action === "zip" && method === "POST") {
      const formData = await requestFormData(input, init)
      const names = formData.getAll("names").map(String)
      return blobResponse(new Blob([demoZipContent(kind, names)]), {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename=${kind}s.zip`,
      })
    }
  }

  if (pathname === "/api/logfile" && method === "GET") {
    return textResponse(state.logLines.join("\n"))
  }

  if (pathname.startsWith("/config/") && method === "GET") {
    return fileDownloadResponse("config", decodeURIComponent(pathname.slice("/config/".length)))
  }

  if (pathname.startsWith("/coeff/") && method === "GET") {
    return fileDownloadResponse("coeff", decodeURIComponent(pathname.slice("/coeff/".length)))
  }

  if (pathname === "/api/backends" && method === "GET") {
    const backends: Schemas["DeviceTypeLists"] = { playback: [...BACKENDS.playback], capture: [...BACKENDS.capture] }
    return jsonResponse(backends)
  }

  const devicesRequest = /^\/api\/devices\/(capture|playback)\/([^/]+)(\/capabilities)?$/.exec(pathname)
  if (devicesRequest && method === "GET") {
    const direction = devicesRequest[1] as Schemas["Direction"]
    const backend = decodeURIComponent(devicesRequest[2])
    if (!devicesRequest[3]) {
      const devices: Schemas["AvailableDevice"][] = demoDeviceOptionsForBackend(backend).map(([name, description]) => ({
        name,
        description,
      }))
      return jsonResponse(devices)
    }
    const device = url.searchParams.get("device") ?? "default"
    if (!isKnownDemoDevice(backend, device)) {
      return errorResponse("device not found", 400)
    }
    if (isBusyDemoDevice(device)) {
      return errorResponse("device busy", 400)
    }
    const backendFormats = demoFormatsForBackend(backend)
    const highRateCapabilities = demoHighRateSamplerates(backendFormats)
    const [baseRate, otherChannels, otherRate] = direction === "capture" ? [44100, 4, 48000] : [48000, 6, 96000]
    const capabilities: Schemas["ChannelCapability"][] = isSixteenChannelDemoDevice(device)
      ? [
          {
            channels: 16,
            samplerates: [
              { samplerate: 48000, formats: [backend === "CoreAudio" || backend === "Wasapi" ? "F32" : "F32_LE"] },
            ],
          },
        ]
      : [
          {
            channels: 2,
            samplerates: [{ samplerate: baseRate, formats: backendFormats }, ...highRateCapabilities],
          },
          { channels: otherChannels, samplerates: [{ samplerate: otherRate, formats: backendFormats.slice(1) }] },
        ]
    // Like WASAPI, which gives shared mode only the mix format.
    const capability_sets: Schemas["DeviceCapabilitySet"][] =
      backend === "Wasapi"
        ? [
            { mode: "Shared", capabilities: capabilities.slice(0, 1) },
            { mode: "Exclusive", capabilities },
          ]
        : [{ mode: "Unified", capabilities }]
    const descriptor: Schemas["AudioDeviceDescriptor"] = {
      name: device,
      description: `${backend} demo ${direction} device`,
      capability_sets,
    }
    return jsonResponse(descriptor)
  }

  if (pathname === "/api/ymltojson" && method === "POST") {
    const { text } = await requestJson<Schemas["ImportText"]>(input, init)
    // Taken as it is, without the backend's checks, migration and filled in optional fields.
    const fragment = (parseYaml(text) ?? {}) as Schemas["ConfigFragment"]
    return jsonResponse(fragment)
  }

  if (pathname === "/api/convolvertojson" && method === "POST") {
    return jsonResponse(
      demoFragment({
        ImportedConvolver: {
          type: "Conv",
          description: null,
          parameters: { type: "Wav", filename: "demo-room.wav", channel: null },
        },
      }),
    )
  }

  if (pathname === "/api/eqapotojson" && method === "POST") {
    return jsonResponse(
      demoFragment({
        ImportedEqApo: {
          type: "Biquad",
          description: null,
          parameters: { type: "Peaking", freq: 1000, q: 0.707, gain: 3 },
        },
      }),
    )
  }

  return errorResponse(`No demo handler for ${method} ${pathname}`, 404)
}

type ChannelState = {
  rms: number
  peak: number
  drift: number
  pulse: number
}

const levelState = new Map<string, ChannelState[]>()

function channelStates(key: string, count: number) {
  const existing = levelState.get(key)
  if (existing && existing.length === count) return existing
  const created = Array.from({ length: count }, (_, index) => ({
    rms: -34 + index * -1.5,
    peak: -20 + index * -1.2,
    drift: Math.random() * Math.PI * 2,
    pulse: 0,
  }))
  levelState.set(key, created)
  return created
}

function updateMusicLevels(target: ChannelState[]) {
  const beat = Math.max(0, Math.sin(Date.now() / 220) ** 8)
  return target.map((channel, index) => {
    channel.drift += 0.06 + index * 0.003
    channel.pulse = channel.pulse * 0.82 + beat * (0.8 - index * 0.08) + Math.random() * 0.12
    const body = -26 + Math.sin(channel.drift) * 4 + Math.sin(channel.drift * 0.53) * 3
    const accent = channel.pulse * 10
    channel.rms = Math.max(-60, Math.min(-3, body + accent - 8))
    channel.peak = Math.max(channel.rms + 1.5, Math.min(0, channel.rms + 5 + Math.random() * 4))
    return channel
  })
}

function generateLevels(): LevelsEvent {
  if (state.processingStopped) {
    return { capture_rms: [], capture_peak: [], playback_rms: [], playback_peak: [] }
  }
  const captureCount = captureChannelCount(state.currentConfig)
  const playbackCount = state.currentConfig.devices.playback.channels
  const capture = updateMusicLevels(channelStates("capture", captureCount))
  const playback = updateMusicLevels(channelStates("playback", playbackCount))
  return {
    capture_rms: capture.map((channel) => (state.mute ? -120 : Number(channel.rms.toFixed(1)))),
    capture_peak: capture.map((channel) => (state.mute ? -120 : Number(channel.peak.toFixed(1)))),
    playback_rms: playback.map((channel) => adjustedPlaybackLevel(channel.rms, state.volume)),
    playback_peak: playback.map((channel) => adjustedPlaybackLevel(channel.peak, state.volume)),
  }
}

function generateSpectrum(params: SpectrumSubscriptionParams): SpectrumEvent {
  const { min_freq, max_freq, n_bins } = params
  const logMin = Math.log10(min_freq)
  const logMax = Math.log10(max_freq)
  const frequencies: number[] = []
  const magnitudes: number[] = []
  for (let i = 0; i < n_bins; i++) {
    const t = i / Math.max(1, n_bins - 1)
    const freq = Math.pow(10, logMin + t * (logMax - logMin))
    frequencies.push(freq)
    const octaves = Math.log2(freq / min_freq)
    const pinkBase = spectrumShape.offset + spectrumShape.slope * octaves
    const noise = (Math.random() - 0.5) * 8
    magnitudes.push(Math.max(-120, Math.min(0, pinkBase + noise)))
  }
  return { frequencies, magnitudes }
}

/** The parameters of a `/api/spectrum` stream, or null for any other URL. */
function parseSpectrumParams(url: string): SpectrumSubscriptionParams | null {
  const parsed = new URL(url, "http://demo")
  if (parsed.pathname !== "/api/spectrum") return null
  const query = parsed.searchParams
  const channel = query.get("channel")
  return {
    side: query.get("side") === "capture" ? "capture" : "playback",
    channel: channel === null ? null : Number(channel),
    min_freq: Number(query.get("min_freq")),
    max_freq: Number(query.get("max_freq")),
    n_bins: Number(query.get("n_bins")),
    max_rate: Number(query.get("max_rate")),
  }
}

function adjustedPlaybackLevel(level: number, gainDb: number) {
  if (state.mute) {
    return -120
  }
  return Number(Math.max(-120, Math.min(0, level + gainDb)).toFixed(1))
}

/** A `/api/state` event, CamillaDSP's StateUpdate. */
function currentStateEvent(): StateEvent {
  return state.processingStopped ? { state: "Inactive", stop_reason: "None" } : { state: "Running" }
}

class DemoEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly CONNECTING = DemoEventSource.CONNECTING
  readonly OPEN = DemoEventSource.OPEN
  readonly CLOSED = DemoEventSource.CLOSED
  readonly withCredentials = false
  readyState = DemoEventSource.CONNECTING
  url: string
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  private timerId?: ReturnType<typeof setInterval>

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    const spectrumParams = parseSpectrumParams(this.url)
    if (spectrumParams) {
      spectrumShape = { offset: -20 - Math.random() * 40, slope: -1 - Math.random() * 5 }
    }
    const isStateStream = new URL(this.url, "http://demo").pathname === "/api/state"
    let lastState = JSON.stringify(currentStateEvent())
    queueMicrotask(() => {
      if (this.readyState !== DemoEventSource.CONNECTING) return
      // Like the backend, a spectrum stream is refused or ended while processing is stopped.
      if (spectrumParams && state.processingStopped) {
        this.fail()
        return
      }
      this.readyState = DemoEventSource.OPEN
      const openEvent = new Event("open")
      this.dispatchEvent(openEvent)
      this.onopen?.call(this as unknown as EventSource, openEvent)
      // Like the backend, a state stream starts with the current state.
      if (isStateStream) this.dispatchEvent(new MessageEvent("state", { data: lastState }))
    })
    this.timerId = setInterval(() => {
      if (this.readyState !== DemoEventSource.OPEN) return
      if (isStateStream) {
        const current = JSON.stringify(currentStateEvent())
        if (current !== lastState) {
          lastState = current
          this.dispatchEvent(new MessageEvent("state", { data: current }))
        }
      } else if (!spectrumParams) {
        this.dispatchEvent(new MessageEvent("levels", { data: JSON.stringify(generateLevels()) }))
      } else if (state.processingStopped) {
        this.fail()
      } else {
        this.dispatchEvent(new MessageEvent("spectrum", { data: JSON.stringify(generateSpectrum(spectrumParams)) }))
      }
    }, LEVEL_INTERVAL_MS)
  }

  private fail() {
    this.close()
    const errorEvent = new Event("error")
    this.dispatchEvent(errorEvent)
    this.onerror?.call(this as unknown as EventSource, errorEvent)
  }

  close() {
    this.readyState = DemoEventSource.CLOSED
    if (this.timerId !== undefined) {
      clearInterval(this.timerId)
      this.timerId = undefined
    }
  }
}

/** A form posted to the API, which is how a zip is downloaded, answered here and saved. */
function submitDemoForm(this: HTMLFormElement) {
  const url = resolveUrl(this.action)
  if (!url.pathname.startsWith("/api/")) {
    nativeSubmit?.call(this)
    return
  }
  void handleApiRequest(url, { method: this.method, body: new FormData(this) }).then(async (response) => {
    if (!response.ok) {
      console.warn("Demo form post failed", await response.text())
      return
    }
    const disposition = response.headers.get("Content-Disposition") ?? ""
    download(/filename="?([^";]+)/.exec(disposition)?.[1] ?? "download", await response.blob())
  })
}

export function installDemoBackend() {
  if (!ENABLE_DEMO_BACKEND || installed) return ENABLE_DEMO_BACKEND
  installed = true
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input)
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/config/") || url.pathname.startsWith("/coeff/")) {
      return handleApiRequest(input, init)
    }
    return nativeFetch(input, init)
  }) as typeof globalThis.fetch
  globalThis.EventSource = DemoEventSource as unknown as typeof EventSource
  if (nativeSubmit) HTMLFormElement.prototype.submit = submitDemoForm
  appendLog("demo backend enabled")
  return true
}

export function restoreNativeNetworking() {
  globalThis.fetch = nativeFetch
  if (NativeEventSource) {
    globalThis.EventSource = NativeEventSource
  }
  if (nativeSubmit) HTMLFormElement.prototype.submit = nativeSubmit
  installed = false
}
