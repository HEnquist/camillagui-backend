import React from "react"
import "reactjs-popup/dist/index.css"
import ReactjsPopup from "reactjs-popup"
import "../index.css"
import { jsonDiff } from "./jsondiff"
import { Config } from "../camilladsp/config"
import { CloseButton } from "../utilities/ui-components"

type DiffRowType = "header" | "prop" | "section" | "comment"

interface DiffTableRow {
  type: DiffRowType
  label: string
  left: string
  right: string
}

export function DiffPopup(props: {
  left_config: Config
  left_name: string
  right_config: Config
  right_name: string
  open: boolean
  onClose: () => void
}) {
  return (
    <ReactjsPopup
      open={props.open}
      onClose={props.onClose}
      closeOnDocumentClick={true}
      contentStyle={{ width: "max-content" }}
    >
      <CloseButton onClick={() => props.onClose()} />
      <div
        style={{
          height: "90vh",
          overflowY: "auto",
          overflowX: "clip",
          padding: "5px",
        }}
      >
        <table className="diff-table">
          {renderDiff(props.left_config, props.right_config, props.left_name, props.right_name)}
        </table>
      </div>
    </ReactjsPopup>
  )
}

function renderDiff(left_config: Config, right_config: Config, left_name: string, right_name: string) {
  const displayrows: DiffTableRow[] = [
    {
      type: "header",
      label: "Comparing:",
      left: left_name,
      right: right_name,
    },
  ]

  let perform_diff = true
  if (left_config === null || left_config == ({} as Config)) {
    perform_diff = false
    displayrows.push({
      type: "comment",
      label: "Comparison not performed.",
      left: "",
      right: "",
    })
    displayrows.push({
      type: "comment",
      label: `"${left_name}" is empty.`,
      left: "",
      right: "",
    })
  }
  if (right_config === null || right_config == ({} as Config)) {
    if (perform_diff) {
      perform_diff = false
      displayrows.push({
        type: "comment",
        label: "Comparison not performed.",
        left: "",
        right: "",
      })
    }
    displayrows.push({
      type: "comment",
      label: `"${right_name}" is empty.`,
      left: "",
      right: "",
    })
  }
  if (perform_diff) {
    const rows = jsonDiff(left_config, right_config)
    let prevPath = ""
    for (const row of rows) {
      const path = "/ " + row.path.slice(0, -1).join(" / ")
      let header = null
      if (path !== prevPath) {
        header = path
        prevPath = path
        displayrows.push({
          type: "section",
          label: header,
          left: "",
          right: "",
        })
      }
      displayrows.push({
        type: "prop",
        label: row.path[row.path.length - 1],
        left: row.before ? String(row.before) : "null",
        right: row.after ? String(row.after) : "null",
      })
    }
    if (displayrows.length === 1) {
      displayrows.push({
        type: "comment",
        label: "The two configs are identical.",
        left: "",
        right: "",
      })
    }
  }
  return displayrows.map((row, idx) => {
    if (row.type === "prop") {
      return (
        <tr key={"diffrow" + idx}>
          <td className="diff-cell">{row.label}</td>
          <td className="diff-cell">
            <pre>{row.left}</pre>
          </td>
          <td className="diff-cell">
            <pre>{row.right}</pre>
          </td>
        </tr>
      )
    } else if (row.type === "section") {
      return (
        <tr key={"diffrow" + idx}>
          <td colSpan={3} className="diff-section-header">
            {row.label}
          </td>
        </tr>
      )
    } else if (row.type === "header") {
      return (
        <tr key={"diffrow" + idx}>
          <td className="diff-filename">{row.label}</td>
          <td className="diff-filename">{row.left}</td>
          <td className="diff-filename">{row.right}</td>
        </tr>
      )
    } else {
      return (
        <tr key={"diffrow" + idx}>
          <td colSpan={3} className="diff-comment">
            {row.label}
          </td>
        </tr>
      )
    }
  })
}
