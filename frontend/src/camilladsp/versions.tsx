import React from "react"
import { Status } from "./status"
import { version } from "../../package.json"

export function VersionLabels(props: { versions: Status }) {
  const { cdsp_version, backend_version } = props.versions
  const tooltip = `
    <table>
      <tr>
        <th class=namecol>Component</th>
        <th class=valuecol>Version</th>
      </tr>
      <tr>
        <td class=namecol>CamillaDSP</td>
        <td class=valuecol>${cdsp_version ?? "(offline)"}</td>
      </tr>
      <tr>
        <td class=namecol>CamillaGUI frontend</td>
        <td class=valuecol>${version}</td>
      </tr>
      <tr>
        <td class=namecol>CamillaGUI backend</td>
        <td class=valuecol>${backend_version}</td>
      </tr>
    </table>
  `
  return (
    <div data-tooltip-html={tooltip} data-tooltip-id="main-tooltip" className="versions">
      <div>CamillaGUI version {version}</div>
    </div>
  )
}
