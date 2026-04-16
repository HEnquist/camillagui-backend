import * as React from "react"
import { mdiHome, mdiPoll } from "@mdi/js"
import { Config } from "./camilladsp/config"
import { isCdspOnline } from "./camilladsp/status"
import { useVuMeterStatus } from "./camilladsp/usevumeterstatus"
import { GuiConfig } from "./guiconfig"
import { QuickConfigSwitch, ShortcutSections } from "./shortcuts"
import { VolumeBox } from "./sidepanel/volumebox"
import { Update } from "./utilities/common"
import { ErrorBoundary, MdiButton } from "./utilities/ui-components"

export type ViewMode = "normal" | "compact" | "dashboard"

export function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search)
  if (params.has("dashboardview")) return "dashboard"
  if (params.has("compactview")) return "compact"
  return "normal"
}

export function setViewMode(mode: ViewMode) {
  const url = new URL(window.location.href)
  if (mode === "compact") {
    url.searchParams.set("compactview", "")
    url.searchParams.delete("dashboardview")
  } else if (mode === "dashboard") {
    url.searchParams.set("dashboardview", "")
    url.searchParams.delete("compactview")
  } else {
    url.searchParams.delete("compactview")
    url.searchParams.delete("dashboardview")
  }
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
  const vuMeterStatus = useVuMeterStatus(guiConfig)

  return (
    <div className="tabpanel" style={{ margin: "auto" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <MdiButton icon={mdiHome} tooltip="Change to normal view" onClick={switchToNormalView} />
        <MdiButton icon={mdiPoll} tooltip="Change to dashboard view" onClick={switchToDashboardView} rotation={90} />
      </div>
      <ErrorBoundary>
        {isCdspOnline(vuMeterStatus) && (
          <VolumeBox
            vuMeterStatus={vuMeterStatus}
            setMessage={() => {}}
            inputLabels={vuMeterStatus.labels.capture}
            outputLabels={vuMeterStatus.labels.playback}
            guiConfig={guiConfig}
          />
        )}
        <ShortcutSections sections={guiConfig.custom_shortcuts} config={config} updateConfig={updateConfig} />
        <QuickConfigSwitch setConfig={setConfig} currentConfigName={currentConfigName} />
      </ErrorBoundary>
    </div>
  )
}
