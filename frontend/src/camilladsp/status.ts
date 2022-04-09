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
    cdsp_version: '',
    py_cdsp_version: '',
    backend_version: '',
    clipped: false
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

  private readonly intervalId: NodeJS.Timer
  private readonly onUpdate: (status: Status) => void
  private lastClippedSamples = 0

  constructor(onUpdate: (status: Status) => void) {
    this.onUpdate = onUpdate
    this.intervalId = setInterval(this.updateStatus.bind(this), 500)
    this.updateStatus()
  }

  private async updateStatus() {
    let status: Status
    try {
      status = await (await fetch("/api/status")).json()
    } catch (err) {
      status = defaultStatus()
    }
    const clipped = this.lastClippedSamples >= 0 && status.clippedsamples > this.lastClippedSamples
    this.lastClippedSamples = status.clippedsamples === '' ? 0 : status.clippedsamples
    this.onUpdate({...status, clipped})
  }

  stop() {
    clearInterval(this.intervalId)
  }

}