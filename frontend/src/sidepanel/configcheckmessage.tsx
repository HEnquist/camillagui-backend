import React from "react"
import {Config} from "../camilladsp/config"
import {ErrorsForPath, errorsOf, noErrors} from "../utilities/errors"
import {delayedExecutor} from "../utilities/ui-components"
import isEqual from "lodash/isEqual"

export class Configcheckmessage extends React.Component<{
  config: Config,
  setErrors: (errors: ErrorsForPath) => void
},
    { message: string }> {

  default_message = "NOT CHECKED"

  constructor(props: any) {
    super(props)
    this.get_config_errors = this.get_config_errors.bind(this)
    this.state = {message: this.default_message}
  }

  private timer = delayedExecutor(500)

  componentDidUpdate(prevProps: { config: Config }) {
    if (!isEqual(prevProps.config, this.props.config))
      this.timer(() => this.get_config_errors(this.props.config))
  }

  private async get_config_errors(config: Config) {
    try {
      const request = await fetch("/api/validateconfig", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(config)
      })
      if (request.ok) {
        const message = await request.text()
        this.setState({message: message})
        this.props.setErrors(noErrors)
      } else {
        const json = await request.json()
        const errors = errorsOf(json)
        const globalErrors = errors({path: []})
        this.setState({message: 'Config has errors' + (globalErrors ? (':\n' + globalErrors) : '')})
        this.props.setErrors(errors)
      }
    } catch (err) {
      this.setState({message: 'Validation failed'})
      this.props.setErrors(noErrors)
    }
  }

  render() {
    const message = this.state.message
    let textColor
    if (message === this.default_message)
      textColor = 'var(--neutral-text-color)'
    else if (message === "OK")
      textColor = 'var(--success-text-color)'
    else
      textColor = 'var(--error-text-color)'
    return <div className="config-status" style={{color: textColor, whiteSpace: 'pre-wrap'}}>{message}</div>
  }
}