import * as React from "react"
import { mdiHome, mdiImageSizeSelectSmall } from "@mdi/js"
import "./index.css"
import { isCdspOnline, isCdspRunning } from "./camilladsp/status"
import { useCdspStatus } from "./camilladsp/usevumeterstatus"
import { VersionLabels } from "./camilladsp/versions"
import { GuiConfig } from "./guiconfig"
import { AuxFadersBox } from "./sidepanel/auxfaderbox"
import camillalogo from "./sidepanel/camilladsp.svg"
import { CdspStateBox } from "./sidepanel/cdspstatebox"
import { VolumeBox } from "./sidepanel/volumebox"
import { SpectrumBox } from "./spectrumbox"
import { MdiButton } from "./utilities/ui-components"

export function DashboardView(props: {
  guiConfig: GuiConfig
  message: string
  switchToNormalView: () => void
  switchToCompactView: () => void
}) {
  const { guiConfig, message, switchToNormalView, switchToCompactView } = props
  const cdspStatus = useCdspStatus(guiConfig)
  const [dspConfigFileName, setDspConfigFileName] = React.useState<string | null>(null)

  const cdspOnline = isCdspOnline(cdspStatus)

  React.useEffect(() => {
    if (!cdspOnline) return
    let cancelled = false
    fetch("/api/getactiveconfigfilename")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text())
        }
        const json = await response.json()
        return (json.configFileName as string | null) ?? null
      })
      .then((configFileName) => {
        if (!cancelled) setDspConfigFileName(configFileName)
      })
      .catch((error) => {
        if (!cancelled) {
          console.log("Failed to fetch DSP config filename", error)
        }
      })

    return () => {
      cancelled = true
      setDspConfigFileName(null)
    }
  }, [cdspOnline])

  const meterSize = {
    width: typeof window === "undefined" ? 1100 : Math.max(290, Math.min(window.innerWidth - 80, 1100)),
    channelHeight: 24,
  }

  return (
    <section className="sidepanel sidepanel-expanded">
      <div className="sidepanel-header">
        <div className="sidepanel-header-main">
          <img className="sidepanel-logo" src={camillalogo} alt="graph" />
          <div className="dashboard-header-info">
            <div className="sidepanel-header-actions dashboard-header-actions">
              <MdiButton
                icon={mdiHome}
                tooltip="Change to normal view"
                buttonSize="small"
                onClick={switchToNormalView}
              />
              <MdiButton
                icon={mdiImageSizeSelectSmall}
                tooltip="Change to compact view"
                buttonSize="small"
                onClick={switchToCompactView}
              />
            </div>
            <div className="dashboard-config-summary box">
              <div className="dashboard-config-title">{cdspStatus.title || "Untitled configuration"}</div>
              <div className="dashboard-config-description">{cdspStatus.description || "No description"}</div>
              <div className="dashboard-config-filename">{dspConfigFileName || "No active config file"}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="sidepanel-content sidepanel-content-expanded">
        {cdspOnline && (
          <VolumeBox
            setMessage={() => {}}
            inputLabels={cdspStatus.labels.capture}
            outputLabels={cdspStatus.labels.playback}
            guiConfig={guiConfig}
            meterSize={meterSize}
            isRunning={isCdspRunning(cdspStatus)}
          />
        )}
        {cdspOnline && (
          <SpectrumBox
            guiConfig={guiConfig}
            labels={cdspStatus.labels}
            width={meterSize.width}
            isRunning={isCdspRunning(cdspStatus)}
          />
        )}
        {cdspOnline && <AuxFadersBox guiConfig={guiConfig} dashboardExpanded={true} />}
        <CdspStateBox status={cdspStatus} message={message} />
        <VersionLabels versions={cdspStatus} />
      </div>
    </section>
  )
}
