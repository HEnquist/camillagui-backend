import React, { useState } from "react"
import "./index.css"
import { mdiChevronDown } from "@mdi/js"
import { getLabelForChannel } from "./camilladsp/config"
import { Labels, SpectrumSubscriptionParams } from "./camilladsp/status"
import { useSpectrumData, useVuMeterLevels } from "./camilladsp/usevumeterstatus"
import { GuiConfig } from "./guiconfig"
import { SpectrumDisplay } from "./spectrum"
import { Box, MdiButton } from "./utilities/ui-components"

export function SpectrumBox(props: { guiConfig: GuiConfig; labels: Labels; width?: number }) {
  const { guiConfig, labels, width } = props
  const [enabled, setEnabled] = useState(false)
  const [side, setSide] = useState<"capture" | "playback">("playback")
  const [channel, setChannel] = useState<number | null>(null)

  const levels = useVuMeterLevels()
  const channelLabels = side === "capture" ? labels.capture : labels.playback
  const vuChannelCount = side === "capture" ? levels.capturesignalrms.length : levels.playbacksignalrms.length
  const nChannels = channelLabels?.length ?? vuChannelCount

  const params: SpectrumSubscriptionParams = {
    side,
    channel,
    min_freq: guiConfig.spectrum_min_freq,
    max_freq: guiConfig.spectrum_max_freq,
    n_bins: guiConfig.spectrum_n_bins,
    max_rate: guiConfig.spectrum_max_rate,
  }

  const spectrumData = useSpectrumData(enabled, params)

  return (
    <Box
      title={
        <>
          <MdiButton
            icon={mdiChevronDown}
            tooltip={enabled ? "Hide spectrum" : "Show spectrum"}
            buttonSize="small"
            highlighted={enabled}
            onClick={() => setEnabled(!enabled)}
          />
          Spectrum
          {enabled && (
            <>
              <select
                value={side}
                onChange={(e) => {
                  setSide(e.target.value as "capture" | "playback")
                  setChannel(null)
                }}
              >
                <option value="playback">Playback</option>
                <option value="capture">Capture</option>
              </select>
              <select
                value={channel === null ? "" : channel.toString()}
                onChange={(e) => setChannel(e.target.value === "" ? null : parseInt(e.target.value, 10))}
              >
                <option value="">Average</option>
                {Array.from({ length: nChannels }, (_, i) => (
                  <option key={i} value={i.toString()}>
                    {getLabelForChannel(channelLabels, i)}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      }
    >
      {enabled && (
        <SpectrumDisplay
          data={spectrumData}
          minDb={guiConfig.spectrum_min_db}
          maxDb={guiConfig.spectrum_max_db}
          minFreq={guiConfig.spectrum_min_freq}
          maxFreq={guiConfig.spectrum_max_freq}
          width={width}
        />
      )}
    </Box>
  )
}
