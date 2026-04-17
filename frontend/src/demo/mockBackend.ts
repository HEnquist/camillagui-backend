import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Config, defaultConfig, WavInfo } from "../camilladsp/config"
import { defaultGuiConfig, GuiConfig } from "../guiconfig"
import { FileInfo } from "../utilities/files"

type DemoState = {
  volume: number
  mute: boolean
  faders: Array<{ volume: number; mute: boolean }>
  currentConfig: Config
  activeConfigFileName: string | null
  storedConfigs: Record<string, Config>
  storedConfigMeta: Record<string, { lastModified: number }>
  storedCoeffs: Record<string, { lastModified: number; size: number; content: string }>
  guiConfig: GuiConfig
  processingStopped: boolean
  logLines: string[]
}

type LevelsPayload = {
  capturesignalrms: number[]
  capturesignalpeak: number[]
  playbacksignalrms: number[]
  playbacksignalpeak: number[]
  ts: number
}

const ENABLE_DEMO_BACKEND = import.meta.env.VITE_ENABLE_DEMO_BACKEND === "true"
const STORAGE_KEY = "camillagui.demo.state.v1"
const LEVEL_INTERVAL_MS = 140
const MAIN_CONFIG_NAME = "living-room-demo.yml"
const CURRENT_CONFIG_VERSION = 4

const BACKENDS = {
  playback: ["Alsa", "CoreAudio", "Wasapi", "Jack", "Pulse", "PipeWire", "File", "Stdout"],
  capture: ["Alsa", "CoreAudio", "Wasapi", "Jack", "Pulse", "PipeWire", "WavFile", "SignalGenerator"],
} as const

const DEVICE_OPTIONS: Record<string, [string, string][]> = {
  Alsa: [
    ["hw:0", "Built-in Audio"],
    ["hw:1", "USB DAC"],
    ["hw:Loopback", "Loopback Interface"],
  ],
  CoreAudio: [
    ["MacBook Pro Speakers", "MacBook Pro Speakers"],
    ["Scarlett 2i2 USB", "Scarlett 2i2 USB"],
    ["BlackHole 16ch", "BlackHole 16ch"],
  ],
  Wasapi: [
    ["Primary Sound Driver", "Primary Sound Driver"],
    ["USB Audio Device", "USB Audio Device"],
  ],
  Jack: [
    ["system", "system"],
    ["studio", "studio"],
  ],
}

let installed = false
const nativeFetch = globalThis.fetch.bind(globalThis)
const NativeEventSource = globalThis.EventSource

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
      [MAIN_CONFIG_NAME]: { lastModified: Math.floor(Date.now() / 1000) - 3600 },
      "headphones-demo.yml": { lastModified: Math.floor(Date.now() / 1000) - 7200 },
    },
    storedCoeffs: {
      "demo-room.wav": {
        lastModified: Math.floor(Date.now() / 1000) - 14400,
        size: 524288,
        content: "demo coeff content",
      },
      "demo-target.raw": {
        lastModified: Math.floor(Date.now() / 1000) - 28800,
        size: 262144,
        content: "demo raw coeff content",
      },
    },
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
      guiConfig: parsed.guiConfig ?? defaultState().guiConfig,
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
  state.storedConfigMeta[name] = { lastModified: Math.floor(Date.now() / 1000) }
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

function generateChartContent(name: string) {
  const points = 192
  const f = Array.from({ length: points }, (_, index) => {
    const min = Math.log10(20)
    const max = Math.log10(20000)
    return 10 ** (min + ((max - min) * index) / (points - 1))
  })
  const nameHash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const magnitude = f.map((freq, index) => {
    const sweep = Math.sin(Math.log(freq) * 1.7 + nameHash * 0.03) * 2.5
    const contour = Math.cos(index / 18 + nameHash * 0.02) * 0.8
    return Number((sweep + contour).toFixed(3))
  })
  const phase = f.map((freq) => Number((Math.sin(Math.log(freq) * 0.9 + nameHash * 0.01) * 70).toFixed(3)))
  const time = Array.from({ length: 256 }, (_, index) => index / state.currentConfig.devices.samplerate)
  const impulse = time.map((t, index) => {
    const center = 18 / state.currentConfig.devices.samplerate
    const distance = (t - center) * state.currentConfig.devices.samplerate * 0.12
    const envelope = Math.exp(-(distance ** 2))
    const ripple = Math.cos(index / 8) * 0.12
    return Number((envelope + ripple).toFixed(5))
  })
  const groupdelay = f.map((freq) => Number((2.5 + Math.sin(Math.log(freq) * 1.3 + nameHash * 0.02) * 0.8).toFixed(3)))
  return {
    name,
    samplerate: state.currentConfig.devices.samplerate,
    channels: captureChannelCount(state.currentConfig),
    options: [
      { name: "48 kHz stereo", samplerate: 48000, channels: 2 },
      { name: "96 kHz stereo", samplerate: 96000, channels: 2 },
      { name: "48 kHz 4 ch", samplerate: 48000, channels: 4 },
    ],
    f,
    magnitude,
    phase,
    time,
    impulse,
    f_groupdelay: f,
    groupdelay,
  }
}

function makeConfigFileInfo(name: string, config: Config): FileInfo {
  const meta = state.storedConfigMeta[name] ?? { lastModified: Math.floor(Date.now() / 1000) }
  return {
    name,
    lastModified: meta.lastModified,
    formattedDate: new Date(meta.lastModified * 1000).toDateString(),
    size: JSON.stringify(config).length,
    title: config.title,
    description: config.description,
    version: CURRENT_CONFIG_VERSION,
    valid: true,
    errors: null,
  }
}

function makeCoeffFileInfo(name: string): FileInfo {
  const coeff = state.storedCoeffs[name]
  return {
    name,
    lastModified: coeff.lastModified,
    formattedDate: new Date(coeff.lastModified * 1000).toDateString(),
    size: coeff.size,
    title: null,
    description: null,
    version: null,
    valid: undefined,
    errors: undefined,
  }
}

function parseBooleanString(value: string) {
  return value.trim().toLowerCase() === "true"
}

function cloneConfig(config: Config) {
  return structuredClone(config)
}

function handleSetParam(pathname: string, value: string) {
  const parts = pathname.split("/").filter(Boolean)
  const name = parts[2]
  if (name === "volume") {
    state.volume = Number(value)
    state.faders[0] = { ...state.faders[0], volume: state.volume }
    appendLog(`main volume set to ${state.volume.toFixed(1)} dB`)
    persistState()
    return textResponse("OK")
  }
  if (name === "mute") {
    state.mute = parseBooleanString(value)
    state.faders[0] = { ...state.faders[0], mute: state.mute }
    appendLog(`main mute set to ${state.mute}`)
    persistState()
    return textResponse("OK")
  }
  return textResponse("Unknown parameter", 404)
}

function handleSetIndexedParam(pathname: string, value: string) {
  const parts = pathname.split("/").filter(Boolean)
  const name = parts[2]
  const index = Number(parts[3])
  const target = state.faders[index]
  if (!target) return textResponse("Invalid fader index", 404)
  if (name === "volume") {
    target.volume = Number(value)
    appendLog(`aux fader ${index} volume set to ${target.volume.toFixed(1)} dB`)
    persistState()
    return textResponse("OK")
  }
  if (name === "mute") {
    target.mute = parseBooleanString(value)
    appendLog(`aux fader ${index} mute set to ${target.mute}`)
    persistState()
    return textResponse("OK")
  }
  return textResponse("Unknown parameter", 404)
}

function makeWavInfo(): WavInfo {
  return {
    dataoffset: 44,
    datalength: 524288,
    sampleformat: "FLOAT32LE",
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
    return jsonResponse({
      configFileName: activeName,
      config: cloneConfig(config),
      source: activeName ? "active" : "dsp",
    })
  }

  if (pathname === "/api/getactiveconfigfilename" && method === "GET") {
    return jsonResponse({ configFileName: state.activeConfigFileName })
  }

  if (pathname === "/api/getconfig" && method === "GET") {
    return jsonResponse(cloneConfig(state.currentConfig))
  }

  if (pathname === "/api/setconfig" && method === "POST") {
    const payload = await requestJson<{ filename?: string; config: Config }>(input, init)
    state.currentConfig = cloneConfig(payload.config)
    state.processingStopped = false
    if (payload.filename) {
      state.activeConfigFileName = payload.filename
    }
    appendLog(`applied config${payload.filename ? ` ${payload.filename}` : ""}`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/saveconfigfile" && method === "POST") {
    const payload = await requestJson<{ filename: string; config: Config }>(input, init)
    state.currentConfig = cloneConfig(payload.config)
    state.storedConfigs[payload.filename] = cloneConfig(payload.config)
    state.activeConfigFileName = payload.filename
    touchConfigFile(payload.filename)
    appendLog(`saved config ${payload.filename}`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/getconfigfile" && method === "GET") {
    const name = url.searchParams.get("name")
    if (!name || !state.storedConfigs[name]) return textResponse("Config file not found", 404)
    return jsonResponse(cloneConfig(state.storedConfigs[name]))
  }

  if (pathname === "/api/getdefaultconfigfile" && method === "GET") {
    return jsonResponse(createSampleConfig())
  }

  if (pathname === "/api/setactiveconfigfile" && method === "POST") {
    const payload = await requestJson<{ name: string }>(input, init)
    if (!state.storedConfigs[payload.name]) return textResponse("Config file not found", 404)
    state.activeConfigFileName = payload.name
    state.currentConfig = cloneConfig(state.storedConfigs[payload.name])
    appendLog(`activated config ${payload.name}`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/status" && method === "GET") {
    const labels = {
      capture: currentCaptureLabels(),
      playback: currentPlaybackLabels(),
    }
    const processingRunning = !state.processingStopped
    return jsonResponse({
      cdsp_status: processingRunning ? "Running" : "Stopped",
      capturerate: processingRunning ? 47999 + Math.round(Math.sin(Date.now() / 5000) * 3) : "",
      rateadjust: processingRunning ? Number((Math.sin(Date.now() / 1800) * 0.08).toFixed(3)) : "",
      bufferlevel: processingRunning ? 22 + Math.round((Math.sin(Date.now() / 1200) + 1) * 18) : "",
      clippedsamples: 0,
      processingload: processingRunning
        ? Number((18 + Math.sin(Date.now() / 900) * 6 + Math.random() * 3).toFixed(1))
        : "",
      resamplerload: processingRunning
        ? Number((6 + Math.sin(Date.now() / 1100) * 2 + Math.random() * 1.5).toFixed(1))
        : "",
      cdsp_version: "demo-3.0.0",
      py_cdsp_version: "demo-1.0.0",
      py_cdsp_plot_version: "demo-1.0.0",
      backend_version: "demo-backend",
      labels,
      title: state.currentConfig.title,
      description: state.currentConfig.description,
    })
  }

  if (pathname === "/api/getparam/volume" && method === "GET") {
    return textResponse(state.volume.toString())
  }

  if (pathname === "/api/getparam/mute" && method === "GET") {
    return textResponse(state.mute ? "True" : "False")
  }

  if (pathname === "/api/getparamjson/faders" && method === "GET") {
    return jsonResponse(state.faders)
  }

  if (pathname.startsWith("/api/setparam/") && method === "POST") {
    return handleSetParam(pathname, await requestText(input, init))
  }

  if (pathname.startsWith("/api/setparamindex/") && method === "POST") {
    return handleSetIndexedParam(pathname, await requestText(input, init))
  }

  if (pathname === "/api/stop" && method === "POST") {
    state.processingStopped = true
    appendLog("processing stopped")
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/validateconfig" && method === "POST") {
    return textResponse("OK")
  }

  if (pathname === "/api/evalfilter" && method === "POST") {
    const payload = await requestJson<{ name?: string }>(input, init)
    return jsonResponse(generateChartContent(payload.name ?? "Filter response"))
  }

  if (pathname === "/api/evalfilterstep" && method === "POST") {
    const payload = await requestJson<{ index?: number }>(input, init)
    return jsonResponse(generateChartContent(`Pipeline step ${payload.index ?? 0}`))
  }

  if (pathname === "/api/wavinfo" && method === "GET") {
    return jsonResponse(makeWavInfo())
  }

  if (pathname === "/api/defaultsforcoeffs" && method === "GET") {
    const filename = url.searchParams.get("file") ?? ""
    const isWav = filename.toLowerCase().endsWith(".wav")
    return jsonResponse({
      type: isWav ? "Wav" : "Raw",
      format: isWav ? undefined : "FLOAT32LE",
      skip_bytes_lines: isWav ? undefined : 0,
      read_bytes_lines: isWav ? undefined : 0,
      errors: [],
    })
  }

  if (pathname === "/api/storedconfigs" && method === "GET") {
    return jsonResponse(Object.entries(state.storedConfigs).map(([name, config]) => makeConfigFileInfo(name, config)))
  }

  if (pathname === "/api/storedcoeffs" && method === "GET") {
    return jsonResponse(Object.keys(state.storedCoeffs).map((name) => makeCoeffFileInfo(name)))
  }

  if (pathname === "/api/uploadconfigs" && method === "POST") {
    const formData = await requestFormData(input, init)
    for (const [, value] of formData.entries()) {
      if (!(value instanceof File)) continue
      const content = await value.text()
      try {
        const parsed = content.trim().startsWith("{") ? JSON.parse(content) : parseYaml(content)
        if (parsed && typeof parsed === "object") {
          state.storedConfigs[value.name] = parsed as Config
        } else {
          state.storedConfigs[value.name] = createSampleConfig()
        }
      } catch {
        state.storedConfigs[value.name] = createSampleConfig()
      }
      touchConfigFile(value.name)
    }
    appendLog("uploaded config file(s)")
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/uploadcoeffs" && method === "POST") {
    const formData = await requestFormData(input, init)
    for (const [, value] of formData.entries()) {
      if (!(value instanceof File)) continue
      state.storedCoeffs[value.name] = {
        lastModified: Math.floor(Date.now() / 1000),
        size: value.size,
        content: await value.text(),
      }
    }
    appendLog("uploaded coeff file(s)")
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/deleteconfigs" && method === "POST") {
    const files = await requestJson<string[]>(input, init)
    files.forEach((name) => {
      delete state.storedConfigs[name]
      delete state.storedConfigMeta[name]
      if (state.activeConfigFileName === name) state.activeConfigFileName = null
    })
    appendLog(`deleted ${files.length} config file(s)`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/deletecoeffs" && method === "POST") {
    const files = await requestJson<string[]>(input, init)
    files.forEach((name) => delete state.storedCoeffs[name])
    appendLog(`deleted ${files.length} coeff file(s)`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/renameconfig" && method === "POST") {
    const source = url.searchParams.get("source")
    const target = url.searchParams.get("target")
    if (!source || !target || !state.storedConfigs[source]) return textResponse("Config file not found", 404)
    state.storedConfigs[target] = state.storedConfigs[source]
    delete state.storedConfigs[source]
    state.storedConfigMeta[target] = state.storedConfigMeta[source] ?? { lastModified: Math.floor(Date.now() / 1000) }
    delete state.storedConfigMeta[source]
    if (state.activeConfigFileName === source) state.activeConfigFileName = target
    appendLog(`renamed config ${source} to ${target}`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/renamecoeff" && method === "POST") {
    const source = url.searchParams.get("source")
    const target = url.searchParams.get("target")
    if (!source || !target || !state.storedCoeffs[source]) return textResponse("Coeff file not found", 404)
    state.storedCoeffs[target] = state.storedCoeffs[source]
    delete state.storedCoeffs[source]
    appendLog(`renamed coeff ${source} to ${target}`)
    persistState()
    return textResponse("OK")
  }

  if (pathname === "/api/downloadconfigszip" && method === "POST") {
    const files = await requestJson<string[]>(input, init)
    const content = JSON.stringify(
      Object.fromEntries(
        files.filter((name) => state.storedConfigs[name]).map((name) => [name, state.storedConfigs[name]]),
      ),
      null,
      2,
    )
    return blobResponse(new Blob([content], { type: "application/zip" }), {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="configs.zip"',
    })
  }

  if (pathname === "/api/downloadcoeffszip" && method === "POST") {
    const files = await requestJson<string[]>(input, init)
    const content = files
      .filter((name) => state.storedCoeffs[name])
      .map((name) => `${name}\n${state.storedCoeffs[name].content}`)
      .join("\n\n")
    return blobResponse(new Blob([content], { type: "application/zip" }), {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="coeffs.zip"',
    })
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
    return jsonResponse([BACKENDS.playback, BACKENDS.capture])
  }

  if (pathname.startsWith("/api/capturedevices/") && method === "GET") {
    const backend = pathname.split("/").at(-1) ?? ""
    return jsonResponse(DEVICE_OPTIONS[backend] ?? [["default", `${backend} demo device`]])
  }

  if (pathname.startsWith("/api/playbackdevices/") && method === "GET") {
    const backend = pathname.split("/").at(-1) ?? ""
    return jsonResponse(DEVICE_OPTIONS[backend] ?? [["default", `${backend} demo device`]])
  }

  if (pathname === "/api/ymltojson" && method === "POST") {
    const parsed = parseYaml(await requestText(input, init))
    return textResponse(JSON.stringify(parsed ?? {}))
  }

  if (pathname === "/api/convolvertojson" && method === "POST") {
    return textResponse(
      JSON.stringify({
        filters: {
          ImportedConvolver: {
            type: "Conv",
            parameters: {
              type: "Wav",
              filename: "demo-room.wav",
            },
          },
        },
      }),
    )
  }

  if (pathname === "/api/eqapotojson" && method === "POST") {
    return textResponse(
      JSON.stringify({
        filters: {
          ImportedEqApo: {
            type: "Biquad",
            parameters: {
              type: "Peaking",
              freq: 1000,
              q: 0.707,
              gain: 3,
            },
          },
        },
      }),
    )
  }

  return textResponse(`No demo handler for ${method} ${pathname}`, 404)
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

function generateLevels(): LevelsPayload {
  if (state.processingStopped) {
    return {
      capturesignalrms: [],
      capturesignalpeak: [],
      playbacksignalrms: [],
      playbacksignalpeak: [],
      ts: Date.now(),
    }
  }
  const captureCount = captureChannelCount(state.currentConfig)
  const playbackCount = state.currentConfig.devices.playback.channels
  const capture = updateMusicLevels(channelStates("capture", captureCount))
  const playback = updateMusicLevels(channelStates("playback", playbackCount))
  return {
    capturesignalrms: capture.map((channel) => (state.mute ? -120 : Number(channel.rms.toFixed(1)))),
    capturesignalpeak: capture.map((channel) => (state.mute ? -120 : Number(channel.peak.toFixed(1)))),
    playbacksignalrms: playback.map((channel) => adjustedPlaybackLevel(channel.rms, state.volume)),
    playbacksignalpeak: playback.map((channel) => adjustedPlaybackLevel(channel.peak, state.volume)),
    ts: Date.now(),
  }
}

function adjustedPlaybackLevel(level: number, gainDb: number) {
  if (state.mute) {
    return -120
  }
  return Number(Math.max(-120, Math.min(0, level + gainDb)).toFixed(1))
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
    queueMicrotask(() => {
      if (this.readyState !== DemoEventSource.CONNECTING) return
      this.readyState = DemoEventSource.OPEN
      const openEvent = new Event("open")
      this.dispatchEvent(openEvent)
      this.onopen?.call(this as unknown as EventSource, openEvent)
    })
    this.timerId = setInterval(() => {
      if (this.readyState !== DemoEventSource.OPEN) return
      const message = new MessageEvent("levels", { data: JSON.stringify(generateLevels()) })
      this.dispatchEvent(message)
    }, LEVEL_INTERVAL_MS)
  }

  close() {
    this.readyState = DemoEventSource.CLOSED
    if (this.timerId !== undefined) {
      clearInterval(this.timerId)
      this.timerId = undefined
    }
  }
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
  appendLog("demo backend enabled")
  return true
}

export function restoreNativeNetworking() {
  globalThis.fetch = nativeFetch
  if (NativeEventSource) {
    globalThis.EventSource = NativeEventSource
  }
  installed = false
}
