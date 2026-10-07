import { api, QueryOf, Schemas } from "../api/client"

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
 * state from `/api/state` in place of `cdsp_online`.
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

export type SpectrumSubscriptionParams = QueryOf<"/api/spectrum">

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

/**
 * Polls `/api/status` for the values that are not worth a stream of their own,
 * and takes the processing state from a `/api/state` stream, so that a change
 * shows at once. The state counts as offline while the stream is down.
 */
export class StatusPoller {
  private timerId: ReturnType<typeof setTimeout> | undefined
  private readonly onUpdate: (status: Status) => void
  private update_interval: number
  private stopped = false
  /** The last answer from `/api/status`, null if the last request failed. */
  private polled: PolledStatus | null = null
  private state: StateEvent | null = null
  private readonly stateStream: StateEventStream
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
    this.stateStream = new StateEventStream((state) => {
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
    this.stateStream.stop()
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
 * One of the backend's event streams. Each open stream is its own CamillaDSP
 * subscription, which closing it ends. It is closed while the page is hidden,
 * and opened again a second after an error, which is also how a subscription
 * the backend refused or ended is retried.
 */
class EventStream {
  private static readonly reconnectDelayMs = 1000
  private source?: EventSource
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly url: string
  private readonly eventName: string
  private readonly onData: (data: unknown) => boolean
  private readonly staleEventThresholdMs?: number
  private readonly onClose?: () => void
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
   * `onData` gets the parsed data of each event called `eventName`, and says
   * whether it was usable. A stream with `staleEventThresholdMs` is reopened
   * when no usable event has come for that long. `onClose` is called when the
   * stream fails or is closed, until which the events seen are current.
   */
  constructor(
    url: string,
    eventName: string,
    onData: (data: unknown) => boolean,
    options: { staleEventThresholdMs?: number; onClose?: () => void } = {},
  ) {
    this.url = url
    this.eventName = eventName
    this.onData = onData
    this.staleEventThresholdMs = options.staleEventThresholdMs
    this.onClose = options.onClose
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
    this.onClose?.()
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

  private markActivity(source: EventSource) {
    if (this.staleEventThresholdMs !== undefined) {
      this.scheduleReconnect(source, this.staleEventThresholdMs)
    }
  }

  private connect() {
    if (this.stopped || document.hidden) return
    const source = new EventSource(this.url)
    this.source = source
    this.markActivity(source)
    source.addEventListener(this.eventName, (rawEvent: Event) => {
      if (this.source !== source) return
      let data: unknown
      try {
        data = JSON.parse((rawEvent as MessageEvent).data)
      } catch {
        // Ignore malformed events and wait for the next one.
        return
      }
      if (this.onData(data)) this.markActivity(source)
    })
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
      this.onClose?.()
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

const STALE_EVENT_THRESHOLD_MS = 5000

export class LevelsEventStream {
  private readonly stream: EventStream

  constructor(onUpdate: (levels: VuMeterStatus) => void) {
    this.stream = new EventStream(
      "/api/levels",
      "levels",
      (data) => {
        const parsed = data as LevelsEvent
        if (
          !Array.isArray(parsed?.capture_rms) ||
          !Array.isArray(parsed.capture_peak) ||
          !Array.isArray(parsed.playback_rms) ||
          !Array.isArray(parsed.playback_peak)
        ) {
          return false
        }
        const levels: VuMeterStatus = {
          capturesignalrms: parsed.capture_rms,
          capturesignalpeak: parsed.capture_peak,
          playbacksignalrms: parsed.playback_rms,
          playbacksignalpeak: parsed.playback_peak,
        }
        cacheLevels(levels)
        onUpdate(levels)
        return true
      },
      { staleEventThresholdMs: STALE_EVENT_THRESHOLD_MS },
    )
  }

  stop() {
    this.stream.stop()
  }
}

export class SpectrumEventStream {
  private readonly stream: EventStream

  // While processing is stopped the backend refuses the subscription, and it is retried.
  constructor(params: SpectrumSubscriptionParams, onUpdate: (event: SpectrumEvent) => void) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      // A missing channel means all channels.
      if (value !== null) query.set(key, String(value))
    }
    this.stream = new EventStream(
      `/api/spectrum?${query}`,
      "spectrum",
      (data) => {
        const parsed = data as SpectrumEvent
        if (!Array.isArray(parsed?.frequencies) || !Array.isArray(parsed.magnitudes)) return false
        onUpdate(parsed)
        return true
      },
      { staleEventThresholdMs: STALE_EVENT_THRESHOLD_MS },
    )
  }

  stop() {
    this.stream.stop()
  }
}

/**
 * The processing state, from CamillaDSP's StateUpdate events. The first event
 * is the current state, the next ones come when it changes, so there is no
 * stale threshold. `onUpdate` gets null when the stream fails, since the state
 * is then unknown until it is open again.
 */
export class StateEventStream {
  private readonly stream: EventStream

  constructor(onUpdate: (state: StateEvent | null) => void) {
    this.stream = new EventStream(
      "/api/state",
      "state",
      (data) => {
        const parsed = data as StateEvent
        if (typeof parsed?.state !== "string") return false
        onUpdate(parsed)
        return true
      },
      { onClose: () => onUpdate(null) },
    )
  }

  stop() {
    this.stream.stop()
  }
}
