import React from "react";
import "./index.css";
import isEqual from "lodash/isEqual";
import camillalogo from "./camilladsp.svg";
import {VolumeBox} from "./volumebox";
import {Box} from "./common-tsx";
import {Config} from "./config";
import {loadActiveConfig} from "./files";

class ConfigCheckMessage extends React.Component<
    { config: Config },
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
      const config_errors = await request.text()
      this.setState({message: config_errors})
    } catch (err) {
      this.setState({message: ''})
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

interface Version { major: number, minor: number, patch: number }

type SidePanelProps = {
  config: Config,
  setConfig: (config: Config) => void,
  currentConfigFile?: string,
  setCurrentConfig: (filename: string, config: Config) => void
}

export class SidePanel extends React.Component<
  SidePanelProps,
  {
    clearTimer: () => void,
    msg: string,
    capture_rms: number[],
    playback_rms: number[],
    state: string,
    rateadjust: number | '',
    capturerate: number | '',
    bufferlevel: number | '',
    nbrclipped: number | '',
    clipped: boolean,
    dsp_ver: Version | null,
    pylib_ver: Version | null,
    backend_ver: Version | null,
  }
> {

  constructor(props: any) {
    super(props)
    this.state = {
      clearTimer: () => {},
      msg: '',
      capture_rms: [],
      playback_rms: [],
      state: 'backend offline',
      rateadjust: '',
      capturerate: '',
      bufferlevel: '',
      nbrclipped: '',
      clipped: false,
      dsp_ver: null,
      pylib_ver: null,
      backend_ver: null,
    }
    this.timer = this.timer.bind(this)
    this.fetchConfig = this.fetchConfig.bind(this)
    this.applyConfig = this.applyConfig.bind(this)
  }

  async componentDidMount() {
    const intervalId = setInterval(this.timer, 500)
    this.setState({ clearTimer: () => {  clearInterval(intervalId) } })
    try {
      const dsp_ver_req = await fetch("/api/version")
      const pylib_ver_req = await fetch("/api/libraryversion")
      const backend_ver_req = await fetch("/api/backendversion")
      const dsp_ver = await dsp_ver_req.json()
      const pylib_ver = await pylib_ver_req.json()
      const backend_ver = await backend_ver_req.json()
      this.setState({
        dsp_ver: dsp_ver,
        pylib_ver: pylib_ver,
        backend_ver: backend_ver,
      })
    } catch (err) {}
    this.loadCurrentConfig()
  }

  componentWillUnmount() {
    this.state.clearTimer()
  }

  private async timer() {
    const state_req = await fetch("/api/getparam/state")
    const processingstate = await state_req.text()
    let capture_rms: number[] = []
    let playback_rms: number[] = []
    let capturerate: number | '' = ''
    let rateadjust: number | '' = ''
    let bufferlevel: number | '' = ''
    let nbrclipped: number | '' = ''
    try {
      const capt_rms_req = await fetch("/api/getlistparam/capturesignalrms")
      const pb_rms_req = await fetch("/api/getlistparam/playbacksignalrms")
      const capturerate_req = await fetch("/api/getparam/capturerate")
      const rateadjust_req = await fetch("/api/getparam/rateadjust")
      const bufferlevel_req = await fetch("/api/getparam/bufferlevel")
      const nbrclipped_req = await fetch("/api/getparam/clippedsamples")
      capture_rms = await capt_rms_req.json()
      playback_rms = await pb_rms_req.json()
      capturerate = parseInt(await capturerate_req.text())
      rateadjust = parseFloat(await rateadjust_req.text())
      bufferlevel = parseInt(await bufferlevel_req.text())
      nbrclipped = parseInt(await nbrclipped_req.text())
    } catch (err) {
      console.log("camilladsp offline")
    }
    console.log(processingstate, capturerate, rateadjust)
    this.setState((state) => ({
      state: processingstate,
      capture_rms: capture_rms,
      playback_rms: playback_rms,
      capturerate: capturerate,
      rateadjust: rateadjust,
      bufferlevel: bufferlevel,
      nbrclipped: nbrclipped,
      clipped: state.nbrclipped >= 0 && nbrclipped > state.nbrclipped,
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
    const activeConfigFile = this.props.currentConfigFile;
    return (
      <section className="tabpanel" style={{width: '250px'}}>
        <img src={camillalogo} alt="graph" width="100%" height="100%" />
        <VolumeBox
            capture_rms={this.state.capture_rms}
            playback_rms={this.state.playback_rms}
            clipped={this.state.clipped}
            setMessage={message => this.setState({msg: message})}/>
        <Box title="CamillaDSP">
          <div className="two-column-grid">
            <div className="alignRight">State:</div><div>{this.state.state}</div>
            <div className="alignRight">Capture samplerate:</div><div>{this.state.capturerate}</div>
            <div className="alignRight">Rate adjust:</div><div>{this.state.rateadjust}</div>
            <div className="alignRight">Clipped samples:</div><div>{this.state.nbrclipped}</div>
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
          <ConfigCheckMessage config={this.props.config} />
        </Box>
        <div className="versions">
          <div>{SidePanel.version('CamillaDSP', this.state.dsp_ver)}</div>
          <div>{SidePanel.version('pyCamillaDSP', this.state.pylib_ver)}</div>
          <div>{SidePanel.version('Backend', this.state.backend_ver)}</div>
        </div>
      </section>
    )
  }

  private static version(label: string, version: Version | null) {
    if (!version)
      return ''
    const {major, minor, patch} = version
    return `${label} ${major}.${minor}.${patch}`
  }
}
