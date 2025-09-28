import Popup from "reactjs-popup"
import 'reactjs-popup/dist/index.css'
import React from "react"
import "../index.css"
import { CloseButton } from "../utilities/ui-components"
import { Config } from "../camilladsp/config"
import { jsonDiff, DiffRow } from "./jsondiff"

type DiffRowType = 'header' | 'prop' | 'section'

interface DiffTableRow {
  type: DiffRowType,
  path: string,
  left: any
  right: any
}

export function DiffPopup(props: {
  left_config: Config,
  left_name: string,
  right_config: Config,
  right_name: string,
  open: boolean,
  onClose: () => void
}) {
  const diffs = jsonDiff(props.left_config, props.right_config)
  return <Popup open={props.open}
    onClose={props.onClose}
    closeOnDocumentClick={true}
    contentStyle={{ width: 'max-content' }}
  >
    <CloseButton onClick={() => props.onClose()} />
    <div style={{ height: '90vh', overflowY: 'auto' }}>
      <table className="diff-table">
        {renderDiff(diffs, props.left_name, props.right_name)}
      </table>
    </div>
  </Popup>

}

function renderDiff(rows: DiffRow[], left_name: string, right_name: string) {
  const displayrows: DiffTableRow[] = [{ type: "header", path: "", left: left_name, right: right_name }]
  let prevPath = ""
  for (const row of rows) {
    const path = '/ ' + row.path.slice(0, -1).join(' / ')
    var header = null
    if (path !== prevPath) {
      header = path
      prevPath = path
      displayrows.push({
        type: "section",
        path: header,
        left: "",
        right: ""
      })
    }
    displayrows.push({
      type: "prop",
      path: row.path[row.path.length - 1],
      left: row.before ? row.before : 'null',
      right: row.after ? row.after : 'null'
    })
  }
  return displayrows.map(row => {
    if (row.type === "prop") {
      return <tr>
        <td className="diff-cell">{row.path}</td>
        <td className="diff-cell"><pre>{row.left}</pre></td>
        <td className="diff-cell"><pre>{row.right}</pre></td>
      </tr>
    }
    else if (row.type === "section") {
      return <tr>
        <td colSpan={3} className="diff-section-header">{row.path}</td>
      </tr>
    }
    else {
      return <tr>
        <td></td>
        <td className="diff-filename"><pre>{row.left}</pre></td>
        <td className="diff-filename"><pre>{row.right}</pre></td>
      </tr>
    }
  })
}