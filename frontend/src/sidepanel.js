import React from "react";
import "./index.css";
import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import {FLASKURL} from "./index.tsx";
import camillalogo from "./camilladsp.svg";
import {VuMeterGroup} from "./vumeter.js";
import {VolumeSlider} from "./volumeslider.js";
import {Box} from "./common-tsx";

class ConfigCheckMessage extends React.Component {

  default_message = "NOT CHECKED"

  constructor(props) {
    super(props);
    this.state = {
      config: cloneDeep(this.props.config),
      message: this.default_message,
    };
    this.get_config_errors = this.get_config_errors.bind(this);
  }

  componentDidUpdate(prevProps) {
    if (!isEqual(this.props.config, this.state.config)) {
      this.setState({ config: cloneDeep(this.props.config) });
      this.get_config_errors(this.props.config);
    }
  }

  async get_config_errors(config) {
    var config_errors = "";
    try {
      const config_errors_req = await fetch(FLASKURL + "/api/validateconfig", {
        method: "POST", // *GET, POST, PUT, DELETE, etc.
        //mode: "same-origin", // no-cors, *cors, same-origin
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        body: JSON.stringify(config), // body data type must match "Content-Type" header
      });
      config_errors = String(await config_errors_req.text());
    } catch (err) {}
    console.log("Errors", config_errors);
    this.setState({ message: config_errors });
  }

  render() {
    const message = this.state.message
    let statusClass
    if (message === this.default_message)
      statusClass = 'neutral'
    else if (message === "OK")
      statusClass = 'success'
    else
      statusClass = 'error'
    return <div className={"config-status " + statusClass}>{message}</div>
  }
}

export class SidePanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      config: cloneDeep(this.props.config),
      msg: "",
      capture_rms: [],
      playback_rms: [],
      state: "backend offline",
      rateadjust: '',
      capturerate: '',
      bufferlevel: '',
      nbrclipped: '',
      clipped: false,
      dsp_ver: null,
      pylib_ver: null,
      backend_ver: null,
    };
    this.timer = this.timer.bind(this);
    this.fetchConfig = this.fetchConfig.bind(this);
    this.applyConfig = this.applyConfig.bind(this);
    this.setVolume = this.setVolume.bind(this);
  }

  componentDidUpdate() {
    if (!isEqual(this.props.config, this.state.config)) {
      this.setState({ config: cloneDeep(this.props.config) });
    }
  }

  async componentDidMount() {
    var intervalId = setInterval(this.timer, 500);
    // store intervalId in the state so it can be accessed later:
    this.setState({ intervalId: intervalId });
    try {
      const dsp_ver_req = await fetch(FLASKURL + "/api/version");
      const pylib_ver_req = await fetch(FLASKURL + "/api/libraryversion");
      const backend_ver_req = await fetch(FLASKURL + "/api/backendversion");
      const dsp_ver = await dsp_ver_req.json();
      const pylib_ver = await pylib_ver_req.json();
      const backend_ver = await backend_ver_req.json();
      this.setState({
        dsp_ver: dsp_ver,
        pylib_ver: pylib_ver,
        backend_ver: backend_ver,
      });
    } catch (err) {
      console.log("camilladsp offline");
    }
    this.loadCurrentConfig();
  }

  componentWillUnmount() {
    // use intervalId from the state to clear the interval
    clearInterval(this.state.intervalId);
  }

  async timer() {
    const state_req = await fetch(FLASKURL + "/api/getparam/state");
    const processingstate = await state_req.text();
    //var signalrange = "";
    var capture_rms = [];
    var playback_rms = [];
    var capturerate = "";
    var rateadjust = "";
    var bufferlevel = "";
    var nbrclipped = "";
    try {
      const capt_rms_req = await fetch(
        FLASKURL + "/api/getlistparam/capturesignalrms"
      );
      const pb_rms_req = await fetch(
        FLASKURL + "/api/getlistparam/playbacksignalrms"
      );
      //const sigrange_req = await fetch(
      //  FLASKURL + "/api/getparam/signalrangedb"
      //);
      const capturerate_req = await fetch(
        FLASKURL + "/api/getparam/capturerate"
      );
      const rateadjust_req = await fetch(FLASKURL + "/api/getparam/rateadjust");
      const bufferlevel_req = await fetch(
        FLASKURL + "/api/getparam/bufferlevel"
      );
      const nbrclipped_req = await fetch(
        FLASKURL + "/api/getparam/clippedsamples"
      );
      //signalrange = parseFloat(await sigrange_req.text());
      capture_rms = await capt_rms_req.json();
      playback_rms = await pb_rms_req.json();
      capturerate = parseInt(await capturerate_req.text());
      rateadjust = parseFloat(await rateadjust_req.text());
      bufferlevel = parseInt(await bufferlevel_req.text());
      nbrclipped = parseInt(await nbrclipped_req.text());
    } catch (err) {
      console.log("camilladsp offline");
    }
    console.log(processingstate, capturerate, rateadjust);
    this.setState((state) => {
      return {
        state: processingstate,
        capture_rms: capture_rms,
        playback_rms: playback_rms,
        capturerate: capturerate,
        rateadjust: rateadjust,
        bufferlevel: bufferlevel,
        nbrclipped: nbrclipped,
        clipped: state.nbrclipped >= 0 && nbrclipped > state.nbrclipped,
      };
    });
  }

  async fetchConfig() {
    const conf_req = await fetch(FLASKURL + "/api/getconfig");
    const config = await conf_req.json();
    console.log(config);
    if (config) {
      this.setState((state) => {
        return { config: config, msg: "OK" };
      });
      this.props.setConfig(config);
    } else {
      console.log("Got an empty config!");
      this.setState((state) => {
        return { msg: "No config received" };
      });
    }
  }

  async setVolume(value) {
    const vol_req = await fetch(FLASKURL + "/api/setparam/volume", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: "same-origin", // no-cors, *cors, same-origin
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
      },
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: value, // body data type must match "Content-Type" header
    });
    const reply = await vol_req.text();
    console.log(reply);
    this.setState((state) => {
      return { volume: value, msg: reply };
    });
  }

  async applyConfig() {
    const conf_req = await fetch(FLASKURL + "/api/setconfig", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify(this.state.config), // body data type must match "Content-Type" header
    });
    const reply = await conf_req.text();
    this.setState(() => ({msg: reply}));
  }

  async loadCurrentConfig() {
    const conf_req = await fetch(FLASKURL + "/api/getactiveconfigfile", {
      method: "GET",
      headers: {"Content-Type": "text/html"},
      cache: "no-cache",
    });
    const json = await conf_req.json();
    this.setState({config: json.config, msg: "OK"});
    this.props.setActiveConfig(json.configFileName, json.config);
  }

  render() {
    const activeConfigFile = this.props.activeConfigFile;
    return (
      <section className="sidepanel">
        <img src={camillalogo} alt="graph" width="100%" height="100%" />
        <Box title="Volume">
            <VuMeterGroup title="In" level={this.state.capture_rms} clipped={this.state.clipped} />
            <VolumeSlider value="0" onChange={this.setVolume} />
            <VuMeterGroup title="Out" level={this.state.playback_rms} clipped={this.state.clipped} />
        </Box>
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
          <div style={{width: '230px', overflowWrap: 'break-word', textAlign: 'center', margin: '0 auto 5px'}}>
            {activeConfigFile}
          </div>
          }
          <div className="two-column-grid">
            <div
              data-tip="Get active config from CamillaDSP"
              className="button"
              onClick={this.fetchConfig}>
              Load from CDSP
            </div>
            <div
              data-tip={activeConfigFile ?
                `Upload config to CamillaDSP and save to ${activeConfigFile}`
                : `Upload config to CamillaDSP`
              }
              className="button"
              onClick={this.applyConfig}>
              Apply to CDSP
            </div>
          </div>
          <ConfigCheckMessage config={this.state.config} />
        </Box>
        <div className="versions">
          <div style={{justifySelf: 'start'}}>{this.version('CamillaDSP', this.state.dsp_ver)}</div>
          <div style={{justifySelf: 'center'}}>{this.version('pyCamillaDSP', this.state.pylib_ver)}</div>
          <div style={{justifySelf: 'end'}}>{this.version('Backend', this.state.backend_ver)}</div>
        </div>
      </section>
    );
  }

  version(label, major_minor_patch) {
    if (!major_minor_patch)
      return ''
    const {major, minor, patch} = major_minor_patch
    return `${label} ${major}.${minor}.${patch}`
  }
}
