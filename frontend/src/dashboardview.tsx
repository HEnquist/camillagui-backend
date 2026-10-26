import * as React from "react"
import { mdiFullscreen, mdiFullscreenExit } from "@mdi/js"
import "./index.css"
import { isCdspOnline, isCdspRunning } from "./camilladsp/status"
import { useCdspStatus } from "./camilladsp/usevumeterstatus"
import { VersionLabels } from "./camilladsp/versions"
import { GuiConfig } from "./guiconfig"
import { AuxFadersBox } from "./sidepanel/auxfaderbox"
import camillalogo from "./sidepanel/camilladsp.svg"
import { CdspStateBox } from "./sidepanel/cdspstatebox"
import { ControllerBox } from "./sidepanel/controllerbox"
import { VolumeBox } from "./sidepanel/volumebox"
import { SpectrumBox } from "./spectrumbox"
import { loadActiveConfigFilename } from "./utilities/files"
import { ErrorBoundary, MdiButton } from "./utilities/ui-components"

/** Below this width the side panel is a drawer, as in index.css, and the tabs take the window. */
const DRAWER_WIDTH = 1000

/**
 * Big meters to read from across the room, the spectrum, the aux faders with their volumes, and
 * the state, with the title of the config that runs. A tab of the Control area, or the whole
 * window for a tablet or a wall display, which a bookmark with `?dashboardview` opens.
 */
export function DashboardView(props: {
  guiConfig: GuiConfig
  fullscreen: boolean
  setFullscreen: (on: boolean) => void
}) {
  const { guiConfig, fullscreen, setFullscreen } = props
  const cdspStatus = useCdspStatus(guiConfig)
  const [dspConfigFileName, setDspConfigFileName] = React.useState<string | null>(null)

  const cdspOnline = isCdspOnline(cdspStatus)

  React.useEffect(() => {
    if (!cdspOnline) return
    let cancelled = false
    loadActiveConfigFilename()
      .then(({ config_file_name }) => {
        if (!cancelled) setDspConfigFileName(config_file_name)
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

  const windowWidth = typeof window === "undefined" ? 1400 : window.innerWidth
  // As a tab, next to the side panel unless that is a drawer
  const available = fullscreen ? windowWidth - 80 : windowWidth > DRAWER_WIDTH ? windowWidth - 400 : windowWidth - 40
  const meterSize = {
    width: Math.max(290, Math.min(available, 1100)),
    // The labels grow with the channel height, and need the width to go with it
    channelHeight: windowWidth < 600 ? 10 : 24,
  }

  const summary = (
    <div className="dashboard-config-summary box">
      <div className="dashboard-config-title">{cdspStatus.title || "Untitled configuration"}</div>
      <div className="dashboard-config-description">{cdspStatus.description || "No description"}</div>
      <div className="dashboard-config-filename">{dspConfigFileName || "No startup config file"}</div>
    </div>
  )

  const content = (
    <>
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
      <CdspStateBox status={cdspStatus} />
      <ControllerBox status={cdspStatus} />
    </>
  )

  if (fullscreen)
    return (
      <section className="sidepanel sidepanel-expanded">
        <div className="sidepanel-header">
          <div className="sidepanel-header-main">
            <img className="sidepanel-logo" src={camillalogo} alt="CamillaDSP" />
            <div className="dashboard-header-info">
              <div className="sidepanel-header-actions dashboard-header-actions">
                <MdiButton
                  icon={mdiFullscreenExit}
                  tooltip="Leave the full screen dashboard"
                  buttonSize="small"
                  onClick={() => setFullscreen(false)}
                />
              </div>
              {summary}
            </div>
          </div>
        </div>
        <div className="sidepanel-content sidepanel-content-expanded">
          {content}
          <VersionLabels versions={cdspStatus} />
        </div>
      </section>
    )

  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="wide-tabpanel dashboard-tabpanel">
          <div className="dashboard-tab-header">
            {summary}
            <MdiButton
              icon={mdiFullscreen}
              tooltip="Show the dashboard full screen, for a tablet or a wall display.<br>Bookmark it to open it that way."
              onClick={() => setFullscreen(true)}
            />
          </div>
          {content}
        </div>
      </div>
    </ErrorBoundary>
  )
}
