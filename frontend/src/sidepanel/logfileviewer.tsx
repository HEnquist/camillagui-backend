import React, { useEffect, useRef, useState } from "react"
import ReactjsPopup from "reactjs-popup"
import { api, errorMessage } from "../api/client"

export function LogFileViewerPopup(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props
  const [log, setLog] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) {
      api.GET("/api/logfile", { parseAs: "text" }).then(({ data, error, response }) => {
        setLog(data ?? errorMessage(error, response))
        const textarea = textareaRef.current
        if (textarea) textarea.scrollTop = textarea.scrollHeight
      })
    }
  }, [open])
  return (
    <ReactjsPopup open={open} onClose={onClose} contentStyle={{ width: "90%", height: "90%" }}>
      <textarea
        value={log}
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
        }}
        className="logfileviewer"
        ref={textareaRef}
        readOnly={true}
      />
    </ReactjsPopup>
  )
}
