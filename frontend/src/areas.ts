/**
 * The GUI has two areas: Control, for what CamillaDSP does and runs, and Edit, for the config
 * editor. The area shown is remembered per browser. Control is the default, since once a system
 * is set up, the GUI is mostly used to control it.
 */
export type Area = "control" | "edit"

const STORAGE_KEY = "camillagui-area"

/** The view modes the areas replaced, still found in bookmarks. Both were for controlling. */
const LEGACY_VIEW_PARAMS = ["compactview", "dashboardview"]

export function getArea(): Area {
  const url = new URL(window.location.href)
  if (LEGACY_VIEW_PARAMS.some((param) => url.searchParams.has(param))) {
    for (const param of LEGACY_VIEW_PARAMS) url.searchParams.delete(param)
    window.history.replaceState(undefined, "", url.href)
    return "control"
  }
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
