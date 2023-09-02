import {Versions} from "./versions"

export interface VuMeterStatus {
  capturesignalrms: number[]
  capturesignalpeak: number[]
  playbacksignalrms: number[]
  playbacksignalpeak: number[]
  clipped: boolean
}

export interface Status extends Versions, VuMeterStatus {
  cdsp_status: string
  capturerate: number | ''
  rateadjust: number | ''
  bufferlevel: number | ''
  clippedsamples: number | ''
  processingload: number | ''
}

export function defaultStatus(): Status {
  return {
    cdsp_status: BACKEND_OFFLINE,
    capturesignalrms: [],
    capturesignalpeak: [],
    playbacksignalrms: [],
    playbacksignalpeak: [],
    capturerate: '',
    rateadjust: '',
    bufferlevel: '',
    clippedsamples: '',
    processingload: '',
    cdsp_version: '',
    py_cdsp_version: '',
    backend_version: '',
    clipped: false,
  }
}

const CDSP_OFFLINE = 'Offline'
export const BACKEND_OFFLINE = 'Backend offline'
export const OFFLINE_STATES = [BACKEND_OFFLINE, CDSP_OFFLINE]

export function isCdspOffline(status: Status): boolean {
  return status.cdsp_status === CDSP_OFFLINE
}

export function isCdspOnline(status: Status): boolean {
  return !OFFLINE_STATES.includes(status.cdsp_status)
}

export function isBackendOnline(status: Status): boolean {
  return status.cdsp_status !== BACKEND_OFFLINE
}

export class StatusPoller {

  private timerId: NodeJS.Timeout
  private readonly onUpdate: (status: Status) => void
  private lastClippedSamples: number = 0
  private lastLevelTime: number = 0
  private capturesignalrms: number[] = []
  private capturesignalpeak: number[] = []
  private playbacksignalpeak: number[] = []
  private playbacksignalrms: number[] = []
  private update_interval: number

  constructor(onUpdate: (status: Status) => void, update_interval: number) {
    this.onUpdate = onUpdate
    this.update_interval = update_interval
    this.timerId = setTimeout(this.updateStatus.bind(this), this.update_interval)
  }

  private async updateStatus() {
    let status: Status
    let now = Date.now();
    let levelsSince = (now - this.lastLevelTime)/1000.0
    try {
      status = await (await fetch("/api/status?since="+levelsSince)).json()
    } catch (err) {
      status = defaultStatus()
    }
    if (status.capturesignalpeak.length > 0 && status.playbacksignalpeak.length > 0) {
      this.capturesignalpeak = status.capturesignalpeak
      this.capturesignalrms = status.capturesignalrms
      this.playbacksignalpeak = status.playbacksignalpeak
      this.playbacksignalrms = status.playbacksignalrms
      this.lastLevelTime = now
    } else {
      status.capturesignalpeak = this.capturesignalpeak
      status.capturesignalrms = this.capturesignalrms
      status.playbacksignalpeak = this.playbacksignalpeak
      status.playbacksignalrms = this.playbacksignalrms
    }
    const clipped_nbr: number = status.clippedsamples === '' ? 0 : status.clippedsamples
    const clipped = this.lastClippedSamples >= 0 && clipped_nbr > this.lastClippedSamples
    this.lastClippedSamples = clipped_nbr
    this.onUpdate({...status, clipped})
    this.timerId = setTimeout(this.updateStatus.bind(this), this.update_interval)
  }

  stop() {
    clearTimeout(this.timerId)
  }

  set_interval(interval: number) {
    this.update_interval = interval
  }

}

