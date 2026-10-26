/**
 * The GUI has two areas: Control, for what CamillaDSP does and runs, and Edit, for the config
 * editor. The area shown is remembered per browser. Control is the default, since once a system
 * is set up, the GUI is mostly used to control it.
 */
export type Area = "control" | "edit"

const STORAGE_KEY = "camillagui-area"

/** The compact view the areas replaced, still found in bookmarks. It was for controlling. */
const LEGACY_COMPACT_PARAM = "compactview"

/**
 * The full screen dashboard, for a tablet or a wall display. It is in the url, so that a bookmark
 * opens it.
 */
const DASHBOARD_PARAM = "dashboardview"

export function getArea(): Area {
  const url = new URL(window.location.href)
  if (url.searchParams.has(LEGACY_COMPACT_PARAM)) {
    url.searchParams.delete(LEGACY_COMPACT_PARAM)
    window.history.replaceState(undefined, "", url.href)
    return "control"
  }
  if (url.searchParams.has(DASHBOARD_PARAM)) return "control"
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "edit" ? "edit" : "control"
  } catch {
    return "control"
  }
}

export function storeArea(area: Area) {
  try {
    window.localStorage.setItem(STORAGE_KEY, area)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

export function isDashboardFullscreen(): boolean {
  return new URLSearchParams(window.location.search).has(DASHBOARD_PARAM)
}

/** Puts the full screen dashboard in the url, so that a reload or a bookmark keeps it. */
export function setDashboardFullscreen(on: boolean) {
  const url = new URL(window.location.href)
  if (on) url.searchParams.set(DASHBOARD_PARAM, "")
  else url.searchParams.delete(DASHBOARD_PARAM)
  window.history.pushState(undefined, "CamillaDSP", url.href)
}
