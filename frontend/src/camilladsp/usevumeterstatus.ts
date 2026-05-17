import * as React from "react"
import {
  defaultStatus,
  defaultVuMeterStatus,
  emptyVuMeterStatus,
  LevelsEvent,
  LevelsEventStream,
  SpectrumEvent,
  SpectrumEventStream,
  SpectrumSubscriptionParams,
  Status,
  StatusPoller,
  VuMeterStatus,
} from "./status"
import { GuiConfig } from "../guiconfig"

export function useCdspStatus(guiConfig: GuiConfig) {
  const [status, setStatus] = React.useState<Status>(defaultStatus())

  React.useEffect(() => {
    const statusPoller = new StatusPoller((nextStatus) => {
      setStatus(nextStatus)
    }, guiConfig.status_update_interval)

    return () => {
      statusPoller.stop()
    }
  }, [guiConfig.status_update_interval])

  return status
}

export function useVuMeterLevels(active = true) {
  const [levels, setLevels] = React.useState<VuMeterStatus>(defaultVuMeterStatus())

  React.useEffect(() => {
    const updateLevels = (event: LevelsEvent) => {
      setLevels({
        capturesignalrms: event.capturesignalrms,
        capturesignalpeak: event.capturesignalpeak,
        playbacksignalrms: event.playbacksignalrms,
        playbacksignalpeak: event.playbacksignalpeak,
      })
    }

    const levelsEventStream = new LevelsEventStream(updateLevels)

    return () => {
      levelsEventStream.stop()
    }
  }, [])

  return active ? levels : emptyVuMeterStatus()
}

export function useSpectrumData(enabled: boolean, params: SpectrumSubscriptionParams): SpectrumEvent {
  const [data, setData] = React.useState<SpectrumEvent>({ frequencies: [], magnitudes: [] })
  const { side, channel, min_freq, max_freq, n_bins, max_rate } = params

  React.useEffect(() => {
    if (!enabled) return
    const stream = new SpectrumEventStream({ side, channel, min_freq, max_freq, n_bins, max_rate }, setData)
    return () => {
      stream.stop()
      setData({ frequencies: [], magnitudes: [] })
    }
  }, [enabled, side, channel, min_freq, max_freq, n_bins, max_rate])

  return data
}
