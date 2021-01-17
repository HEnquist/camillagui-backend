import React from "react";
import "./index.css";
import isEqual from "lodash/isEqual";
import cloneDeep from "lodash/cloneDeep";
import { FLASKURL } from "./index.tsx";
import camillalogo from "./camilladsp.svg";
import { VuMeterGroup } from "./vumeter.js";
import { VolumeSlider } from "./volumeslider.js";

export class ErrorBox extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      config: cloneDeep(this.props.config),
      message: "(not updated)",
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
    return <div className="textbox">{this.state.message}</div>;
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
      state: "IDLE",
      rateadjust: 0.0,
      capturerate: 0,
      bufferlevel: 0,
      nbrclipped: -1,
      clipped: false,
      dsp_ver: { major: 0, minor: 0, patch: 0 },
      pylib_ver: { major: 0, minor: 0, patch: 0 },
      backend_ver: { major: 0, minor: 0, patch: 0 },
    };
    this.timer = this.timer.bind(this);
    this.fetchConfig = this.fetchConfig.bind(this);
    this.applyConfig = this.applyConfig.bind(this);
    this.saveConfig = this.saveConfig.bind(this);
    this.loadFile = this.loadFile.bind(this);
    this.loadYaml = this.loadYaml.bind(this);
    this.uploadConfig = this.uploadConfig.bind(this);
    this.uploadCoeff = this.uploadCoeff.bind(this);
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
      var clipped = false;
      if (state.nbrclipped >= 0 && nbrclipped > state.nbrclipped) {
        clipped = true;
      }
      return {
        state: processingstate,
        capture_rms: capture_rms,
        playback_rms: playback_rms,
        capturerate: capturerate,
        rateadjust: rateadjust,
        bufferlevel: bufferlevel,
        nbrclipped: nbrclipped,
        clipped: clipped,
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
      this.props.onChange(config);
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
      //mode: "same-origin", // no-cors, *cors, same-origin
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify(this.state.config), // body data type must match "Content-Type" header
    });
    const reply = await conf_req.text();
    console.log(reply);
    this.setState((state) => {
      return { msg: reply };
    });
  }

  async saveConfig() {
    const conf_req = await fetch(FLASKURL + "/api/configtoyml", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: "same-origin", // no-cors, *cors, same-origin
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify(this.state.config), // body data type must match "Content-Type" header
    });
    const reply = await conf_req.text();
    let bl = new Blob([reply], {
      type: "text/html",
    });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(bl);
    a.download = "config.yml";
    a.hidden = true;
    document.body.appendChild(a);
    a.innerHTML = "abcdefg";
    a.click();
  }

  async uploadConfig(event) {
    var file = event.target.files[0];
    const formData = new FormData();
    formData.append("contents", file, file.name);
    await fetch(FLASKURL + "/api/uploadconfig", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: 'same-origin', // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: formData, // body data type must match "Content-Type" header
    });
  }

  async uploadCoeff(event) {
    var file = event.target.files[0];
    const formData = new FormData();
    formData.append("contents", file, file.name);
    await fetch(FLASKURL + "/api/uploadcoeff", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: 'same-origin', // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: formData, // body data type must match "Content-Type" header
    });
  }

  loadCurrentConfig() {
    this.loadYaml(FLASKURL + "/api/getcurrentconfigfile", {
          method: "GET",
          headers: {"Content-Type": "text/html"},
          cache: "no-cache",
        }
    );
  }

  loadFile(event) {
    var file = event.target.files[0];
    var reader = new FileReader();
    reader.readAsText(file, "UTF-8");
    reader.onload = (readerEvent) => {
      var content = readerEvent.target.result;
      console.log(content);
      this.loadYaml(FLASKURL + "/api/ymltojson", {
            method: "POST",
            headers: { "Content-Type": "text/html" },
            cache: "no-cache",
            body: content,
          }
      );
    };
  }

  async loadYaml(url, requestParams) {
    const conf_req = await fetch(url, requestParams);
    const config = await conf_req.json();
    console.log(config);
    this.setState((state) => {
      return { config: config, msg: "OK" };
    });
    this.props.onChange(config);
  }

  render() {
    return (
      <section className="sidepanel">
        <div className="sidepanelelement">
          <img src={camillalogo} alt="graph" width="100%" height="100%" />
        </div>
        <div className="sidepanelelement">
          <VuMeterGroup
            level={this.state.capture_rms}
            clipped={this.state.clipped}
          />
        </div>
        <div className="sidepanelelement">
          <VuMeterGroup
            level={this.state.playback_rms}
            clipped={this.state.clipped}
          />
        </div>
        <div className="sidepanelelement">
          <VolumeSlider value="0" onChange={this.setVolume} /> 
        </div>
        <div className="sidepanelelement">State: {this.state.state}</div>
        <div className="sidepanelelement">
          Capture samplerate: {this.state.capturerate}
        </div>
        <div className="sidepanelelement">
          Rate adjust: {this.state.rateadjust}
        </div>
        <div className="sidepanelelement">
          Clipped samples: {this.state.nbrclipped}
        </div>
        <div className="sidepanelelement">
          Buffer level: {this.state.bufferlevel}
        </div>
        <div className="sidepanelelement">Message: {this.state.msg}</div>
        <div className="sidepanelelement">
          <button
            data-tip="Get active config from CamillaDSP"
            onClick={this.fetchConfig}
          >
            Get
          </button>
        </div>
        <div className="sidepanelelement">
          <button
            data-tip="Upload config to CamillaDSP"
            onClick={this.applyConfig}
          >
            Apply
          </button>
        </div>
        <div className="sidepanelelement">
          <button
            data-tip="Save config to a local file"
            onClick={this.saveConfig}
          >
            Save to file
          </button>
        </div>

        <div className="sidepanelelement">
          Load config from a local file
          <input
            className="fileinput"
            data-tip="Load config from a local file"
            type="file"
            onChange={this.loadFile}
          ></input>
        </div>
        <div className="sidepanelelement">
          Upload a config file
          <input
            className="fileinput"
            data-tip="Upload a config file"
            type="file"
            onChange={this.uploadConfig}
          ></input>
        </div>
        <div className="sidepanelelement">
          Upload a coefficient file
          <input
            className="fileinput"
            data-tip="Upload a coefficient file"
            type="file"
            onChange={this.uploadCoeff}
          ></input>
        </div>
        <div className="sidepanelelement">Config status</div>
        <ErrorBox config={this.state.config} />
        <div className="sidepanelelement">
          <div>Versions</div>
          <div>
            CamillaDSP: {this.state.dsp_ver.major}.{this.state.dsp_ver.minor}.
            {this.state.dsp_ver.patch}
          </div>
          <div>
            pyCamillaDSP: {this.state.pylib_ver.major}.
            {this.state.pylib_ver.minor}.{this.state.pylib_ver.patch}
          </div>
          <div>
            Backend: {this.state.backend_ver.major}.
            {this.state.backend_ver.minor}.{this.state.backend_ver.patch}
          </div>
        </div>
      </section>
    );
  }
}
