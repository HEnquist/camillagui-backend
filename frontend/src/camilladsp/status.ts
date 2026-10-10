import { api, Schemas } from "../api/client"

export interface VuMeterStatus {
  capturesignalrms: number[]
  capturesignalpeak: number[]
  playbacksignalrms: number[]
  playbacksignalpeak: number[]
}

export type Labels = Schemas["ChannelLabels"]

/** What `/api/status` answers. */
type PolledStatus = Schemas["Status"]

/**
 * The status the GUI shows: what `/api/status` answers, with the processing
 * state from `/api/events` in place of `cdsp_online`.
 */
export type Status = Omit<PolledStatus, "cdsp_online"> & {
  /** CamillaDSP's processing state, like "Running", or one of the OFFLINE_STATES. */
  cdsp_status: string
}

/**
 * A `state` event, CamillaDSP's StateUpdate passed on unchanged by the backend.
 * `stop_reason` is there only when the state is "Inactive".
 */
export type StateEvent = Schemas["StateUpdate"]

export type StatusWithLevels = Status & VuMeterStatus

/** A `levels` event, CamillaDSP's VuLevels passed on unchanged by the backend. */
export type LevelsEvent = Schemas["VuLevels"]

/** A `spectrum` event, CamillaDSP's SpectrumData passed on unchanged by the backend. */
export type SpectrumEvent = Schemas["SpectrumData"]

/** The spectrum part of an `/api/events` query, CamillaDSP's SpectrumSubscription. */
export type SpectrumSubscriptionParams = Schemas["SpectrumSubscription"]

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
    capturerate: null,
    rateadjust: null,
    bufferlevel: null,
    clippedsamples: null,
    processingload: null,
    resamplerload: null,
    cdsp_version: null,
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

/**
 * Polls `/api/status` for the values that are not worth a stream of their own,
 * and takes the processing state from the tab's `/api/events` stream, so that a
 * change shows at once. The state counts as offline while the stream is down.
 */
export class StatusPoller {
  private timerId: ReturnType<typeof setTimeout> | undefined
  private readonly onUpdate: (status: Status) => void
  private update_interval: number
  private stopped = false
  /** The last answer from `/api/status`, null if the last request failed. */
  private polled: PolledStatus | null = null
  private state: StateEvent | null = null
  private readonly dropState: () => void
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
    this.dropState = eventStream.subscribeState((state) => {
      this.state = state
      this.publish()
    })
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
    try {
      const { data } = await api.GET("/api/status")
      if (!data) throw new Error("The backend did not send a status")
      this.polled = data
      this.publish()
    } catch {
      this.polled = null
      this.onUpdate(defaultStatus())
    }
    this.scheduleNext(this.update_interval)
  }

  /** Pass on the last polled values with the current state, once there are any. */
  private publish() {
    if (this.stopped || !this.polled) return
    const { cdsp_online, ...values } = this.polled
    const status: Status = {
      ...values,
      cdsp_status: cdsp_online && this.state ? this.state.state : CDSP_OFFLINE,
    }
    cacheStatus(status)
    this.onUpdate(status)
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
    this.dropState()
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
  }

  setInterval(interval: number) {
    this.update_interval = interval
    if (!document.hidden) {
      this.scheduleNext(this.update_interval)
    }
  }
}

/**
 * An open `/api/events` stream with a fixed query. It is closed while the page
 * is hidden, and opened again a second after an error, or when nothing, not
 * even a heartbeat, has come for a while.
 */
class EventStream {
  private static readonly reconnectDelayMs = 1000
  private source?: EventSource
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly url: string
  private readonly handlers: Record<string, (data: unknown) => void>
  private readonly staleEventThresholdMs: number
  private readonly onClose: () => void
  private readonly handleVisibilityChange = () => {
    if (this.stopped) return
    if (document.hidden) {
      this.clearReconnectTimer()
      this.closeSource()
      return
    }
    if (!this.source) this.connect()
  }

  /**
   * `handlers` get the parsed data of the events with their name. The stream is
   * reopened when no event has come for `staleEventThresholdMs`. `onClose` is
   * called when the stream fails or is closed, until which the events seen are
   * current, but not when it is stopped.
   */
  constructor(
    url: string,
    handlers: Record<string, (data: unknown) => void>,
    staleEventThresholdMs: number,
    onClose: () => void,
  ) {
    this.url = url
    this.handlers = handlers
    this.staleEventThresholdMs = staleEventThresholdMs
    this.onClose = onClose
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    if (!document.hidden) this.connect()
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private closeSource() {
    if (!this.source) return
    this.source.close()
    this.source = undefined
    this.onClose()
  }

  private scheduleReconnect(source: EventSource, delayMs: number) {
    this.clearReconnectTimer()
    if (this.stopped || document.hidden) return
    this.reconnectTimer = setTimeout(() => {
      if (this.stopped || document.hidden || this.source !== source) return
      this.closeSource()
      this.connect()
    }, delayMs)
  }

  private connect() {
    if (this.stopped || document.hidden) return
    const source = new EventSource(this.url)
    this.source = source
    this.scheduleReconnect(source, this.staleEventThresholdMs)
    // The heartbeat has no handler, it only shows that the stream is alive.
    for (const name of [...Object.keys(this.handlers), "heartbeat"]) {
      source.addEventListener(name, (rawEvent: Event) => {
        if (this.source !== source) return
        this.scheduleReconnect(source, this.staleEventThresholdMs)
        let data: unknown
        try {
          data = JSON.parse((rawEvent as MessageEvent).data)
        } catch {
          // Ignore malformed events and wait for the next one.
          return
        }
        this.handlers[name]?.(data)
      })
    }
    source.onerror = () => {
      if (this.source !== source) return
      if (this.stopped) {
        this.clearReconnectTimer()
        source.close()
        this.source = undefined
        return
      }
      // The browser would reconnect by itself, but the events seen so far are
      // no longer current until it has.
      this.onClose()
      this.scheduleReconnect(source, EventStream.reconnectDelayMs)
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

/** The backend sends a heartbeat every 2 s, so this is a few missed in a row. */
const STALE_EVENT_THRESHOLD_MS = 5000

/** The order of the spectrum parameters in the query, so that equal wants give equal URLs. */
const SPECTRUM_KEYS = ["side", "channel", "min_freq", "max_freq", "n_bins", "max_rate"] as const

/** The query of an `/api/events` stream with these levels and spectrum. */
function eventsUrl(levels: boolean, spectrum: SpectrumSubscriptionParams | undefined) {
  const query = new URLSearchParams()
  if (levels) query.set("levels", "true")
  if (spectrum) {
    for (const key of SPECTRUM_KEYS) {
      const value = spectrum[key]
      // A missing channel means all channels.
      // Omitted (undefined) optional parameters are dropped too, not sent as "undefined".
      if (value != null) query.set(key, String(value))
    }
  }
  const text = query.toString()
  return text ? `/api/events?${text}` : "/api/events"
}

function parseState(data: unknown): StateEvent | null {
  const parsed = data as StateEvent
  return typeof parsed?.state === "string" ? parsed : null
}

function parseLevels(data: unknown): VuMeterStatus | null {
  const parsed = data as LevelsEvent
  if (
    !Array.isArray(parsed?.capture_rms) ||
    !Array.isArray(parsed.capture_peak) ||
    !Array.isArray(parsed.playback_rms) ||
    !Array.isArray(parsed.playback_peak)
  ) {
    return null
  }
  return {
    capturesignalrms: parsed.capture_rms,
    capturesignalpeak: parsed.capture_peak,
    playbacksignalrms: parsed.playback_rms,
    playbacksignalpeak: parsed.playback_peak,
  }
}

function parseSpectrum(data: unknown): SpectrumEvent | null {
  const parsed = data as SpectrumEvent
  return Array.isArray(parsed?.frequencies) && Array.isArray(parsed.magnitudes) ? parsed : null
}

type SpectrumWant = { params: SpectrumSubscriptionParams; onUpdate: (event: SpectrumEvent) => void }

/**
 * The one `/api/events` stream of this browser tab. A browser has only six
 * connections to the backend for all its tabs, and an open stream holds one,
 * so everything the tab shows live comes on this one.
 *
 * Consumers register what they want and get back a function that drops it.
 * The stream carries the state for as long as anything is registered, the
 * levels while anyone wants them, and the spectrum of the last spectrum
 * registered. A change in what is wanted opens the stream again with the new
 * query, once the current task is done, so that dropping and adding back the
 * same want, as a re-render does, leaves it open.
 */
export class EventStreamManager {
  private stream?: EventStream
  private url?: string
  private updateQueued = false
  /** The last state, null while the stream is down. */
  private state: StateEvent | null = null
  private readonly stateListeners = new Set<(state: StateEvent | null) => void>()
  private readonly levelListeners = new Set<(levels: VuMeterStatus) => void>()
  private readonly spectrumWants: SpectrumWant[] = []

  /**
   * The state, and null while the stream is down, since it is not known then. A stream that is
   * already open does not send the state again, so a new listener gets the last one at once.
   */
  subscribeState(onUpdate: (state: StateEvent | null) => void): () => void {
    const drop = this.add(this.stateListeners, onUpdate)
    if (this.state) onUpdate(this.state)
    return drop
  }

  private setState(state: StateEvent | null) {
    this.state = state
    this.stateListeners.forEach((listener) => listener(state))
  }

  subscribeLevels(onUpdate: (levels: VuMeterStatus) => void): () => void {
    return this.add(this.levelListeners, onUpdate)
  }

  /** The backend starts the spectrum once processing runs, and again after it was stopped. */
  subscribeSpectrum(params: SpectrumSubscriptionParams, onUpdate: (event: SpectrumEvent) => void): () => void {
    const want = { params: { ...params }, onUpdate }
    this.spectrumWants.push(want)
    this.queueUpdate()
    return () => {
      const index = this.spectrumWants.indexOf(want)
      if (index >= 0) this.spectrumWants.splice(index, 1)
      this.queueUpdate()
    }
  }

  private add<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener)
    this.queueUpdate()
    return () => {
      listeners.delete(listener)
      this.queueUpdate()
    }
  }

  private queueUpdate() {
    if (this.updateQueued) return
    this.updateQueued = true
    queueMicrotask(() => {
      this.updateQueued = false
      this.update()
    })
  }

  /** The URL for what is wanted now, undefined when nothing is. */
  private wantedUrl(): string | undefined {
    const spectrum = this.spectrumWants.at(-1)?.params
    const wanted = this.stateListeners.size > 0 || this.levelListeners.size > 0 || spectrum !== undefined
    return wanted ? eventsUrl(this.levelListeners.size > 0, spectrum) : undefined
  }

  private update() {
    const url = this.wantedUrl()
    if (url === this.url) return
    // A stream stopped for a new query does not say the state went away, the new one starts
    // with the current state.
    this.stream?.stop()
    this.stream = undefined
    this.url = url
    if (url === undefined) {
      this.state = null
      return
    }
    this.stream = new EventStream(
      url,
      {
        state: (data) => {
          const state = parseState(data)
          if (state) this.setState(state)
        },
        levels: (data) => {
          const levels = parseLevels(data)
          if (!levels) return
          cacheLevels(levels)
          this.levelListeners.forEach((listener) => listener(levels))
        },
        spectrum: (data) => {
          const spectrum = parseSpectrum(data)
          if (spectrum) this.spectrumWants.at(-1)?.onUpdate(spectrum)
        },
      },
      STALE_EVENT_THRESHOLD_MS,
      () => this.setState(null),
    )
  }
}

/** The event stream of this browser tab. */
export const eventStream = new EventStreamManager()
