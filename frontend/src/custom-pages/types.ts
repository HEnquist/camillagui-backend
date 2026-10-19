import type React from "react"
import type { Config } from "../camilladsp/config"
import type { GuiConfig } from "../guiconfig"
import type { Errors } from "../utilities/errors"

export interface CustomPageProps {
  config: Config
  updateConfig: (update: (config: Config) => void) => void
  guiConfig: GuiConfig
  errors: Errors
}

export type CustomPageComponent = React.ComponentType<CustomPageProps> & {
  tabLabel: string
  enabled?: boolean
}
