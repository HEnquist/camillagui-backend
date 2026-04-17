import * as React from "react"
import {
  defaultStatus,
  defaultVuMeterStatus,
  LevelsEvent,
  LevelsEventStream,
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

export function useVuMeterLevels() {
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

  return levels
}
