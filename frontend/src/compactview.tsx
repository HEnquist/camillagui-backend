import * as React from "react"
import { mdiHome, mdiPoll } from "@mdi/js"
import { Config } from "./camilladsp/config"
import { isCdspOnline, isCdspRunning } from "./camilladsp/status"
import { useCdspStatus } from "./camilladsp/usevumeterstatus"
import { GuiConfig } from "./guiconfig"
import { QuickConfigSwitch, ShortcutSections } from "./shortcuts"
import { VolumeBox } from "./sidepanel/volumebox"
import { Update } from "./utilities/common"
import { ErrorBoundary, MdiButton, mediaMatches } from "./utilities/ui-components"

export type ViewMode = "normal" | "compact" | "dashboard"

const VIEW_PARAMS: Record<ViewMode, string> = {
  normal: "normalview",
  compact: "compactview",
  dashboard: "dashboardview",
}

/** On a phone the GUI is mostly a remote control, so it opens in the compact view there */
function defaultViewMode(): ViewMode {
  return mediaMatches("(max-width: 600px)") ? "compact" : "normal"
}

export function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search)
  if (params.has("dashboardview")) return "dashboard"
  if (params.has("compactview")) return "compact"
  if (params.has("normalview")) return "normal"
  return defaultViewMode()
}

/** Puts the view in the url, so a reload keeps it. The default view leaves the url as it is. */
export function setViewMode(mode: ViewMode) {
  const url = new URL(window.location.href)
  for (const param of Object.values(VIEW_PARAMS)) url.searchParams.delete(param)
  if (mode !== defaultViewMode()) url.searchParams.set(VIEW_PARAMS[mode], "")
  window.history.pushState(undefined, "CamillaDSP", url.href)
}

export function isCompactViewEnabled(): boolean {
  return getViewMode() === "compact"
}

export function setCompactViewEnabled(enabled: boolean) {
  setViewMode(enabled ? "compact" : "normal")
}

export function CompactView(props: {
  currentConfigName?: string
  config: Config
  updateConfig: (update: Update<Config>) => void
  setConfig: (name: string, config: Config) => void
  switchToNormalView: () => void
  switchToDashboardView: () => void
  guiConfig: GuiConfig
}) {
  const { currentConfigName, config, setConfig, updateConfig, switchToNormalView, switchToDashboardView, guiConfig } =
    props
  const cdspStatus = useCdspStatus(guiConfig)

  return (
    <div className="compactview">
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <MdiButton icon={mdiHome} tooltip="Change to normal view" onClick={switchToNormalView} />
        <MdiButton icon={mdiPoll} tooltip="Change to dashboard view" onClick={switchToDashboardView} rotation={90} />
      </div>
      <ErrorBoundary>
        {isCdspOnline(cdspStatus) && (
          <VolumeBox
            setMessage={() => {}}
            inputLabels={cdspStatus.labels.capture}
            outputLabels={cdspStatus.labels.playback}
            guiConfig={guiConfig}
            isRunning={isCdspRunning(cdspStatus)}
          />
        )}
        <ShortcutSections sections={guiConfig.custom_shortcuts} config={config} updateConfig={updateConfig} />
        <QuickConfigSwitch setConfig={setConfig} currentConfigName={currentConfigName} />
      </ErrorBoundary>
    </div>
  )
}
