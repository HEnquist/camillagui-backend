import * as React from "react"
import { defaultStatus, LevelsEvent, LevelsEventStream, StatusPoller, StatusWithLevels } from "./status"
import { GuiConfig } from "../guiconfig"

export function useVuMeterStatus(guiConfig: GuiConfig) {
  const [vuMeterStatus, setVuMeterStatus] = React.useState<StatusWithLevels>(defaultStatus())

  React.useEffect(() => {
    const updateLevels = (event: LevelsEvent) => {
      setVuMeterStatus((prevState) => ({
        ...prevState,
        capturesignalrms: event.capturesignalrms,
        capturesignalpeak: event.capturesignalpeak,
        playbacksignalrms: event.playbacksignalrms,
        playbacksignalpeak: event.playbacksignalpeak,
      }))
    }

    const statusPoller = new StatusPoller((status) => {
      setVuMeterStatus((prevState) => ({
        ...status,
        capturesignalrms: prevState.capturesignalrms,
        capturesignalpeak: prevState.capturesignalpeak,
        playbacksignalrms: prevState.playbacksignalrms,
        playbacksignalpeak: prevState.playbacksignalpeak,
      }))
    }, guiConfig.status_update_interval)
    const levelsEventStream = new LevelsEventStream(updateLevels)

    return () => {
      statusPoller.stop()
      levelsEventStream.stop()
    }
  }, [guiConfig.status_update_interval])

  return vuMeterStatus
}
