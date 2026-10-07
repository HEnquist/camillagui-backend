import { Versions } from "./versions"

export interface VuMeterStatus {
  capturesignalrms: number[]
  capturesignalpeak: number[]
  playbacksignalrms: number[]
  playbacksignalpeak: number[]
}

export interface Labels {
  capture: (string | null)[] | null
  playback: (string | null)[] | null
}

export interface Status extends Versions {
  cdsp_status: string
  capturerate: number | ""
  rateadjust: number | ""
  bufferlevel: number | ""
  clippedsamples: number | ""
  processingload: number | ""
  resamplerload: number | ""
  labels: Labels
  title: string | null
  description: string | null
}

export interface StatusWithLevels extends Status, VuMeterStatus {}

/** A `levels` event, CamillaDSP's VuLevels passed on unchanged by the backend. */
export interface LevelsEvent {
  capture_rms: number[]
  capture_peak: number[]
  playback_rms: number[]
  playback_peak: number[]
}

export interface SpectrumEvent {
  frequencies: number[]
  magnitudes: number[]
}

export interface SpectrumSubscriptionParams {
  side: "capture" | "playback"
  channel: number | null
  min_freq: number
  max_freq: number
  n_bins: number
  max_rate: number
}

const CACHE_MAX_AGE_MS = 5000
const VISIBILITY_RESUME_DELAY_MS = 100

let cachedStatus: Status | null = null
let cachedLevels: VuMeterStatus | null = null
let lastCacheUpdate = 0

export function emptyVuMeterStatus(): VuMeterStatus {
  return {
    capturesignalrms: [],
    capturesignalpeak: [],
    playbacksignalrms: [],
    playbacksignalpeak: [],
  }
}

export function defaultVuMeterStatus(): VuMeterStatus {
  return cachedLevels ?? emptyVuMeterStatus()
}

function offlineStatus(): Status {
  return {
    cdsp_status: BACKEND_OFFLINE,
    capturerate: "",
    rateadjust: "",
    bufferlevel: "",
    clippedsamples: "",
    processingload: "",
    resamplerload: "",
    cdsp_version: "",
    backend_version: "",
    labels: { playback: null, capture: null },
    title: null,
    description: null,
  }
}

function isCacheFresh() {
  return lastCacheUpdate > 0 && Date.now() - lastCacheUpdate < CACHE_MAX_AGE_MS
}

function cacheStatus(status: Status) {
  cachedStatus = { ...status, labels: { ...status.labels } }
  lastCacheUpdate = Date.now()
}

function cacheLevels(levels: VuMeterStatus) {
  cachedLevels = {
    capturesignalrms: [...levels.capturesignalrms],
    capturesignalpeak: [...levels.capturesignalpeak],
    playbacksignalrms: [...levels.playbacksignalrms],
    playbacksignalpeak: [...levels.playbacksignalpeak],
  }
  lastCacheUpdate = Date.now()
}

export function defaultStatus(): StatusWithLevels {
  if (isCacheFresh()) {
    return {
      ...(cachedStatus ?? offlineStatus()),
      ...(cachedLevels ?? emptyVuMeterStatus()),
    }
  }
  return {
    ...offlineStatus(),
    ...emptyVuMeterStatus(),
  }
}

const CDSP_OFFLINE = "Offline"
export const BACKEND_OFFLINE = "Backend offline"
export const OFFLINE_STATES = [BACKEND_OFFLINE, CDSP_OFFLINE]

export function isCdspOnline(status: Status): boolean {
  return !OFFLINE_STATES.includes(status.cdsp_status)
}

export function isBackendOnline(status: Status): boolean {
  return status.cdsp_status !== BACKEND_OFFLINE
}

export function isCdspRunning(status: Status): boolean {
  return status.cdsp_status.toLowerCase() === "running"
}

export class StatusPoller {
  private timerId: ReturnType<typeof setTimeout> | undefined
  private readonly onUpdate: (status: Status) => void
  private update_interval: number
  private stopped = false
  private readonly handleVisibilityChange = () => {
    if (this.stopped) {
      return
    }
    if (document.hidden) {
      this.clearTimer()
      return
    }
    this.scheduleNext(VISIBILITY_RESUME_DELAY_MS)
  }

  constructor(onUpdate: (status: Status) => void, update_interval: number) {
    this.onUpdate = onUpdate
    this.update_interval = update_interval
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    if (!document.hidden) {
      this.scheduleNext(this.update_interval)
    }
  }

  private async updateStatus() {
    if (this.stopped || document.hidden) {
      this.clearTimer()
      return
    }
    this.timerId = undefined
    let status: Status
    try {
      status = await (await fetch("/api/status")).json()
      cacheStatus(status)
    } catch {
      status = defaultStatus()
    }
    this.onUpdate(status)
    this.scheduleNext(this.update_interval)
  }

  private clearTimer() {
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId)
      this.timerId = undefined
    }
  }

  private scheduleNext(delayMs: number) {
    this.clearTimer()
    if (this.stopped || document.hidden) {
      return
    }
    this.timerId = setTimeout(this.updateStatus.bind(this), delayMs)
  }

  stop() {
    this.stopped = true
    this.clearTimer()
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
  }

  setInterval(interval: number) {
    this.update_interval = interval
    if (!document.hidden) {
      this.scheduleNext(this.update_interval)
    }
  }
}

export class LevelsEventStream {
  private static readonly reconnectDelayMs = 1000
  private static readonly staleEventThresholdMs = 5000
  private source?: EventSource
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly onUpdate: (levels: VuMeterStatus) => void
  private readonly handleVisibilityChange = () => {
    if (this.stopped) {
      return
    }
    if (document.hidden) {
      this.clearReconnectTimer()
      this.source?.close()
      this.source = undefined
      return
    }
    if (!this.source) {
      this.connect()
    }
  }

  constructor(onUpdate: (levels: VuMeterStatus) => void) {
    this.onUpdate = onUpdate
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    if (!document.hidden) {
      this.connect()
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private scheduleReconnect(source: EventSource, delayMs: number) {
    this.clearReconnectTimer()
    if (this.stopped || document.hidden) return
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped || document.hidden || this.source !== source) return
      source.close()
      this.source = undefined
      this.connect()
    }, delayMs)
  }

  private markActivity(source: EventSource) {
    this.scheduleReconnect(source, LevelsEventStream.staleEventThresholdMs)
  }

  private connect() {
    if (this.stopped || document.hidden) return
    const source = new EventSource("/api/levels")
    this.source = source
    this.markActivity(source)
    source.addEventListener("levels", (rawEvent: Event) => {
      if (this.source !== source) return
      this.markActivity(source)
      const message = rawEvent as MessageEvent
      try {
        const parsed = JSON.parse(message.data) as LevelsEvent
        if (
          Array.isArray(parsed.capture_rms) &&
          Array.isArray(parsed.capture_peak) &&
          Array.isArray(parsed.playback_rms) &&
          Array.isArray(parsed.playback_peak)
        ) {
          const levels: VuMeterStatus = {
            capturesignalrms: parsed.capture_rms,
            capturesignalpeak: parsed.capture_peak,
            playbacksignalrms: parsed.playback_rms,
            playbacksignalpeak: parsed.playback_peak,
          }
          cacheLevels(levels)
          this.onUpdate(levels)
        }
      } catch {
        // Ignore malformed SSE payloads and wait for next frame.
      }
    })
    source.onerror = () => {
      if (this.source !== source) return
      if (this.stopped) {
        source.close()
        this.source = undefined
        this.clearReconnectTimer()
        return
      }
      this.scheduleReconnect(source, LevelsEventStream.reconnectDelayMs)
    }
  }

  stop() {
    this.stopped = true
    this.clearReconnectTimer()
    this.source?.close()
    this.source = undefined
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
  }
}

export class SpectrumEventStream {
  private static readonly reconnectDelayMs = 1000
  private static readonly staleEventThresholdMs = 5000
  private source?: EventSource
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly params: SpectrumSubscriptionParams
  private readonly onUpdate: (event: SpectrumEvent) => void
  private readonly handleVisibilityChange = () => {
    if (this.stopped) return
    if (document.hidden) {
      this.clearReconnectTimer()
      this.source?.close()
      this.source = undefined
      return
    }
    if (!this.source) this.connect()
  }

  constructor(params: SpectrumSubscriptionParams, onUpdate: (event: SpectrumEvent) => void) {
    this.params = params
    this.onUpdate = onUpdate
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    if (!document.hidden) this.connect()
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private scheduleReconnect(source: EventSource, delayMs: number) {
    this.clearReconnectTimer()
    if (this.stopped || document.hidden) return
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped || document.hidden || this.source !== source) return
      source.close()
      this.source = undefined
      this.connect()
    }, delayMs)
  }

  private markActivity(source: EventSource) {
    this.scheduleReconnect(source, SpectrumEventStream.staleEventThresholdMs)
  }

  private url() {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(this.params)) {
      // A missing channel means all channels.
      if (value !== null) query.set(key, String(value))
    }
    return `/api/spectrum?${query}`
  }

  // The stream is the subscription: closing it ends the subscription. While
  // processing is stopped the backend refuses it, and onerror retries.
  private connect() {
    if (this.stopped || document.hidden) return
    const source = new EventSource(this.url())
    this.source = source
    this.markActivity(source)
    source.addEventListener("spectrum", (rawEvent: Event) => {
      if (this.source !== source) return
      const message = rawEvent as MessageEvent
      try {
        const parsed = JSON.parse(message.data)
        if (Array.isArray(parsed.frequencies) && Array.isArray(parsed.magnitudes)) {
          this.markActivity(source)
          this.onUpdate(parsed as SpectrumEvent)
        }
      } catch {
        // Ignore malformed events
      }
    })
    source.onerror = () => {
      if (this.source !== source) return
      if (this.stopped) {
        source.close()
        this.source = undefined
        this.clearReconnectTimer()
        return
      }
      this.scheduleReconnect(source, SpectrumEventStream.reconnectDelayMs)
    }
  }

  stop() {
    this.stopped = true
    this.clearReconnectTimer()
    this.source?.close()
    this.source = undefined
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
  }
}
