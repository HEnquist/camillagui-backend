import React from "react";
import "./index.css";
import isEqual from "lodash/isEqual";
import camillalogo from "./camilladsp.svg";
import {VolumeBox} from "./volumebox";
import {Box} from "./common-tsx";
import {Config} from "./config";
import {loadActiveConfig} from "./files";

class ConfigCheckMessage extends React.Component<
    {
      config: Config,
      setErrors: (errors: any) => void
    },
    { message: string }
> {

  default_message = "NOT CHECKED"

  constructor(props: any) {
    super(props)
    this.get_config_errors = this.get_config_errors.bind(this)
    this.state = {message: this.default_message}
  }

  componentDidUpdate(prevProps: { config: Config }) {
    if (!isEqual(prevProps.config, this.props.config))
      this.get_config_errors(this.props.config)
  }

  private async get_config_errors(config: Config) {
    try {
      const request = await fetch("/api/validateconfig", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(config),
      })
      if (request.ok) {
        const message = await request.text()
        this.setState({message: message})
        this.props.setErrors({})
      } else {
        const errors = await request.json()
        this.props.setErrors(errors)
        this.setState({message: 'Config has errors'})
      }
    } catch (err) {
      this.setState({message: ''})
      this.props.setErrors({})
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
    return <div className="config-status" style={{color: textColor}}>{message}</div>
  }
}

interface SidePanelProps {
  config: Config
  setConfig: (config: Config) => void
  setErrors: (errors: any) => void
  currentConfigFile?: string
  setCurrentConfig: (filename: string, config: Config) => void
}

interface Status {
  cdsp_status: string
  capturesignalrms: number[]
  playbacksignalrms: number[]
  capturerate: number | ''
  rateadjust: number | ''
  bufferlevel: number | ''
  clippedsamples: number | ''
  cdsp_version: string
  py_cdsp_version: string
  backend_version: string
}

export class SidePanel extends React.Component<
  SidePanelProps,
  Status & {
    clearTimer: () => void
    msg: string
    clipped: boolean
  }
> {

  constructor(props: any) {
    super(props)
    this.state = {
      clearTimer: () => {},
      msg: '',
      capturesignalrms: [],
      playbacksignalrms: [],
      cdsp_status: 'backend offline',
      rateadjust: '',
      capturerate: '',
      bufferlevel: '',
      clippedsamples: '',
      clipped: false,
      cdsp_version: '',
      py_cdsp_version: '',
      backend_version: ''
    }
    this.timer = this.timer.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
  }

  async componentDidMount() {
    const intervalId = setInterval(this.timer, 500)
    this.setState({clearTimer: () => clearInterval(intervalId)})
    this.timer()
    this.loadCurrentConfig()
  }

  componentWillUnmount() {
    this.state.clearTimer()
  }

  offline_states = ['backend offline', 'offline']

  private async timer() {
    let status: Status
    try {
      status = await (await fetch("/api/status")).json()
    } catch (err) {
      status = {
        cdsp_status: 'backend offline',
        capturesignalrms: [],
        playbacksignalrms: [],
        capturerate: '',
        rateadjust: '',
        bufferlevel: '',
        clippedsamples: '',
        cdsp_version: '',
        py_cdsp_version: '',
        backend_version: '',
      }
    }
    this.setState((oldState) => ({
      ...status,
      clipped: oldState.clippedsamples >= 0 && status.clippedsamples > oldState.clippedsamples,
    }))
  }

  private async fetchConfig() {
    const conf_req = await fetch("/api/getconfig")
    const config = await conf_req.json()
    if (config) {
      this.setState({msg: "OK"})
      this.props.setConfig(config);
    } else {
      this.setState({msg: "No config received"})
    }
  }

  private async applyConfig() {
    const conf_req = await fetch("/api/setconfig", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        filename: this.props.currentConfigFile,
        config: this.props.config
      }),
    })
    const reply = await conf_req.text()
    this.setState({msg: reply})
  }

  async loadCurrentConfig() {
    const json = await loadActiveConfig();
    this.setState({msg: "OK"});
    this.props.setCurrentConfig(json.configFileName, json.config);
  }

  render() {
    const activeConfigFile = this.props.currentConfigFile
    const cdsp_state = this.state.cdsp_status
    return (
      <section className="tabpanel" style={{width: '250px'}}>
        <img src={camillalogo} alt="graph" width="100%" height="100%" />
        {!this.offline_states.includes(cdsp_state) && <VolumeBox
            capture_rms={this.state.capturesignalrms}
            playback_rms={this.state.playbacksignalrms}
            clipped={this.state.clipped}
            setMessage={message => this.setState({msg: message})}/>}
        <Box title="CamillaDSP">
          <div className="two-column-grid">
            <div className="alignRight">State:</div><div>{cdsp_state}</div>
            <div className="alignRight">Capture samplerate:</div><div>{this.state.capturerate}</div>
            <div className="alignRight">Rate adjust:</div><div>{this.state.rateadjust}</div>
            <div className="alignRight">Clipped samples:</div><div>{this.state.clippedsamples}</div>
            <div className="alignRight">Buffer level:</div><div>{this.state.bufferlevel}</div>
            <div className="alignRight">Message:</div><div>{this.state.msg}</div>
          </div>
        </Box>
        <Box title="Config">
          {activeConfigFile &&
          <div style={{width: '220px', overflowWrap: 'break-word', textAlign: 'center', margin: '0 auto 5px'}}>
            {activeConfigFile}
          </div>
          }
          <div className="two-column-grid">
            <div
              data-tip="Get active config from CamillaDSP"
              className="button button-with-text"
              onClick={this.fetchConfig}>
              Load from CDSP
            </div>
            <div
                data-tip={activeConfigFile ?
                    `Upload config to CamillaDSP and save to ${activeConfigFile}`
                    : `Upload config to CamillaDSP`
                }
                 className="button button-with-text"
                onClick={this.applyConfig}>
              Apply to CDSP
            </div>
          </div>
          <ConfigCheckMessage config={this.props.config} setErrors={this.props.setErrors}/>
        </Box>
        <div className="versions">
          <div>CamillaDSP {this.state.cdsp_version}</div>
          <div>pyCamillaDSP {this.state.py_cdsp_version}</div>
          <div>Backend {this.state.backend_version}</div>
        </div>
      </section>
    )
  }
}
