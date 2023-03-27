import React from "react"
import "./index.css"
import { TextInput, MultilineTextInput, Box } from "./utilities/ui-components"
import { Config } from "./camilladsp/config"
import {Update} from "./utilities/common"



export function TitleTab(props: {
    config: Config,
    updateConfig: (update: Update<Config>) => void
  }) {
    return <div className="tabpanel">
      <Title
          config={props.config}
          onChange={props.updateConfig}/>
        <Description
          config={props.config}
          onChange={props.updateConfig}/>
    </div>
  }

function Title(props: {
    config: Config
    onChange: (update: Update<Config>) => void
  }) {
    return <Box title="Title">
        <TextInput
                placeholder="none"
                className="textbox"
                value={props.config.title === null ? "": props.config.title}
                data-tip="Optional title for the configuration"
                onChange={title => title === "" ? props.onChange(config => { config.title = null }) : props.onChange(config => { config.title = title })} 
                />
    </Box>
  }

function Description(props: {
    config: Config
    onChange: (update: Update<Config>) => void
  }) {
    return <Box title="Description">
        <MultilineTextInput
                placeholder="none"
                className="textbox"
                rows={10}
                value={props.config.description === null ? "": props.config.description}
                data-tip="Optoional description for the configuration"
                onChange={desc => desc === "" ? props.onChange(config => { config.description = null }) : props.onChange(config => { config.description = desc })} 
                />
    </Box>
  }
