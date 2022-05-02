import React, {useEffect, useRef, useState} from "react"
import Popup from "reactjs-popup"

export function LogFileViewerPopup(props: {
  open: boolean
  onClose: () => void
}) {
  const {open, onClose} = props
  const [log, setLog] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) {
      fetch("/api/logfile")
          .then(response => response.text())
          .then(text => {
            setLog(text)
            const textarea = textareaRef.current
            if (textarea)
              textarea.scrollTop = textarea.scrollHeight
          })
    }
  }, [open])
  return <Popup open={open} onClose={onClose} contentStyle={{width: '90%', height: '90%'}}>
        <textarea
            value={log}
            style={{width: '100%', height:'100%', boxSizing: 'border-box'}}
            className="logfileviewer"
            ref={textareaRef}
            readOnly={true}
        />
  </Popup>
}