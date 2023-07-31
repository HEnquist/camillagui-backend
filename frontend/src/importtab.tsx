import React from "react"
import {Button} from "./utilities/ui-components"

export function Importtab(props: {}) {
  return <>
    <Button text="Import from Clipboard" onClick={() => {}}/>
    <Button text="Import Equalizer APO Config" onClick={() => {}}/>
    <Button text="Import REW Config" onClick={() => {}}/>
    <div>All Configs from backend here...</div>
  </>
}