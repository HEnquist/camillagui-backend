import { values } from "lodash"
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

export interface Volume {
  volume: number
  mute: boolean
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

  private timerId: NodeJS.Timer
  private readonly onUpdate: (status: Status) => void
  private lastClippedSamples = 0
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
    } catch (err) {
      status = defaultStatus()
    }
    const clipped = this.lastClippedSamples >= 0 && status.clippedsamples > this.lastClippedSamples
    this.lastClippedSamples = status.clippedsamples === '' ? 0 : status.clippedsamples
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

export class VolumePoller {

  private timerId: NodeJS.Timer
  private readonly onUpdate: (volume: Volume) => void
  private update_interval: number

  constructor(onUpdate: (volume: Volume) => void, update_interval: number) {
    this.onUpdate = onUpdate
    this.update_interval = update_interval
    this.timerId = setTimeout(this.updateVolume.bind(this), this.update_interval)
  }

  private async updateVolume() {
    console.log("poll volume")
    try {
      let vol = await (await fetch("/api/getparam/volume")).text()
      let mute = await (await fetch("/api/getparam/mute")).text()
      let volume: Volume = {
        volume: parseFloat(vol),
        mute: mute==="True"?true:false,
      }
      this.onUpdate(volume)
    } catch (err) {console.log(err)}
    this.timerId = setTimeout(this.updateVolume.bind(this), this.update_interval)
  }

  stop() {
    clearTimeout(this.timerId)
  }

  set_interval(interval: number) {
    this.update_interval = interval
  }

  restart_interval() {
    console.log("restart volume poll interval")
    clearTimeout(this.timerId)
    this.timerId = setTimeout(this.updateVolume.bind(this), 5*this.update_interval)
  }

}