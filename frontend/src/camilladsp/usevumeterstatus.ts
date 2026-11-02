import * as React from "react"
import {
  defaultStatus,
  defaultVuMeterStatus,
  emptyVuMeterStatus,
  eventStream,
  SpectrumEvent,
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

/** The VU levels, from the tab's event stream, which every caller shares. */
export function useVuMeterLevels(active = true) {
  const [levels, setLevels] = React.useState<VuMeterStatus>(defaultVuMeterStatus())

  React.useEffect(() => eventStream.subscribeLevels(setLevels), [])

  return active ? levels : emptyVuMeterStatus()
}

/**
 * The spectrum, from the tab's event stream. The backend starts it once processing runs, so it
 * can stay enabled while processing is stopped.
 */
export function useSpectrumData(enabled: boolean, params: SpectrumSubscriptionParams): SpectrumEvent {
  const [data, setData] = React.useState<SpectrumEvent>({ frequencies: [], magnitudes: [] })
  const { side, channel, min_freq, max_freq, n_bins, max_rate } = params

  React.useEffect(() => {
    if (!enabled) return
    const drop = eventStream.subscribeSpectrum({ side, channel, min_freq, max_freq, n_bins, max_rate }, setData)
    return () => {
      drop()
      setData({ frequencies: [], magnitudes: [] })
    }
  }, [enabled, side, channel, min_freq, max_freq, n_bins, max_rate])

  return data
}
