import React from "react"
import {Status} from "./status"

export interface Versions {
  cdsp_version: string
  py_cdsp_version: string
  backend_version: string
}

export function VersionLabels(props: {versions: Status}) {
  const {cdsp_version, py_cdsp_version, backend_version} = props.versions
  return <div className="versions">
    <div>CamillaDSP {cdsp_version}</div>
    <div>pyCamillaDSP {py_cdsp_version}</div>
    <div>Backend {backend_version}</div>
  </div>
}