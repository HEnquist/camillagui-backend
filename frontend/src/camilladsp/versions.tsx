import React from "react"
import {Status} from "./status"
import {version} from "../../package.json"

export interface Versions {
  cdsp_version: string
  py_cdsp_version: string
  py_cdsp_plot_version: string
  backend_version: string
}

export function VersionLabels(props: {versions: Status}) {
  const {cdsp_version, py_cdsp_version, py_cdsp_plot_version, backend_version} = props.versions
  let tooltip = "CamillaDSP: " + cdsp_version + "<br>pyCamillaDSP: " + py_cdsp_version + "<br>pyCamillaDSP-plot: " + py_cdsp_plot_version + "<br>GUI backend: " + backend_version
  return <div  data-tooltip-html={tooltip} data-tooltip-id="main-tooltip" className="versions">
    <div>CamillaGUI version {version}</div>
  </div>
}