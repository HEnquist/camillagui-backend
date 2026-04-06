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

export interface Status extends Versions, VuMeterStatus {
  cdsp_status: string
  capturerate: number | ""
  rateadjust: number | ""
  bufferlevel: number | ""
  clippedsamples: number | ""
  processingload: number | ""
  resamplerload: number | ""
  labels: Labels
}

export interface LevelsEvent {
  side: "capture" | "playback"
  rms: number[]
  peak: number[]
  ts: number
}

export function defaultStatus(): Status {
  return {
    cdsp_status: BACKEND_OFFLINE,
    capturesignalrms: [],
    capturesignalpeak: [],
    playbacksignalrms: [],
    playbacksignalpeak: [],
    capturerate: "",
    rateadjust: "",
    bufferlevel: "",
    clippedsamples: "",
    processingload: "",
    resamplerload: "",
    cdsp_version: "",
    py_cdsp_version: "",
    py_cdsp_plot_version: "",
    backend_version: "",
    labels: { playback: null, capture: null },
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

function levelsStreamUrl(): string {
  if (import.meta.env.DEV && window.location.port !== "5005") {
    return `${window.location.protocol}//${window.location.hostname}:5005/api/events`
  }
  return "/api/events"
}

export class StatusPoller {
  private timerId: NodeJS.Timeout
  private readonly onUpdate: (status: Status) => void
  private update_interval: number

  constructor(onUpdate: (status: Status) => void, update_interval: number) {
    this.onUpdate = onUpdate
    this.update_interval = update_interval
    this.timerId = setTimeout(this.updateStatus.bind(this), this.update_interval)
  }

  private async updateStatus() {
    let status: Status
    try {
      status = await (await fetch("/api/status")).json()
    } catch {
      status = defaultStatus()
    }
    this.onUpdate(status)
    this.timerId = setTimeout(this.updateStatus.bind(this), this.update_interval)
  }

  stop() {
    clearTimeout(this.timerId)
  }

  set_interval(interval: number) {
    this.update_interval = interval
  }
}

export class LevelsEventStream {
  private source?: EventSource
  private stopped = false
  private readonly onUpdate: (event: LevelsEvent) => void

  constructor(onUpdate: (event: LevelsEvent) => void) {
    this.onUpdate = onUpdate
    this.connect()
  }

  private connect() {
    if (this.stopped) return
    const url = levelsStreamUrl()
    const source = new EventSource(url)
    this.source = source
    source.addEventListener("levels", (rawEvent: Event) => {
      if (this.source !== source) return
      const message = rawEvent as MessageEvent
      try {
        const parsed = JSON.parse(message.data) as LevelsEvent
        if (parsed.side === "capture" || parsed.side === "playback") {
          this.onUpdate(parsed)
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
      }
    }
  }

  stop() {
    this.stopped = true
    this.source?.close()
    this.source = undefined
  }
}
