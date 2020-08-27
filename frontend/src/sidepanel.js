import React from 'react';
import './index.css';
import { FLASKURL } from './index.tsx'
import camillalogo from './camilladsp.svg';

export class SidePanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { config: this.props.config, msg: "", signalrange: 0.0, state: "IDLE", rateadjust: 0.0, capturerate: 0 };
    this.timer = this.timer.bind(this);
    this.fetchConfig = this.fetchConfig.bind(this);
    this.applyConfig = this.applyConfig.bind(this);
    this.saveConfig = this.saveConfig.bind(this);
    this.loadFile = this.loadFile.bind(this);
    this.loadYaml = this.loadYaml.bind(this);
  }

  componentDidMount() {
    var intervalId = setInterval(this.timer, 1000);
    // store intervalId in the state so it can be accessed later:
    this.setState({ intervalId: intervalId });
  }

  componentWillUnmount() {
    // use intervalId from the state to clear the interval
    clearInterval(this.state.intervalId);
  }

  async timer() {
    //"state"
    //"signalrange"
    //"signalrangedB"
    //"capturerateraw"
    //"capturerate"
    //"rateadjust"
    //"updateinterval"
    //"configname"
    const state_req = await fetch(FLASKURL + "/api/getparam/state");
    const processingstate = await state_req.text();
    var signalrange = "";
    var capturerate = "";
    var rateadjust =  "";
    try {
      const sigrange_req = await fetch(FLASKURL + "/api/getparam/signalrangedB");
      const capturerate_req = await fetch(FLASKURL + "/api/getparam/capturerate");
      const rateadjust_req = await fetch(FLASKURL + "/api/getparam/rateadjust");
      signalrange = parseFloat(await sigrange_req.text());
      capturerate = parseInt(await capturerate_req.text());
      rateadjust = parseFloat(await rateadjust_req.text());
    }
    catch(err) {
      console.log("camilladsp offline")
    }
    console.log(processingstate,  signalrange, capturerate, rateadjust)
    this.setState(state => { return {state: processingstate, signalrange: signalrange, capturerate: capturerate, rateadjust: rateadjust}});

  }

  async fetchConfig() {
    const conf_req = await fetch(FLASKURL + "/api/getconfig");
    const config = await conf_req.json();
    console.log(config)
    this.setState(state => { return {config: config, msg: "OK"}});
    this.props.onChange(config);
  }

  async applyConfig() {
    const conf_req = await fetch(FLASKURL + "/api/setconfig", {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *cors, same-origin
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify(this.state.config) // body data type must match "Content-Type" header
    });
    const reply = await conf_req.text();
    console.log(reply)
    this.setState(state => { return {msg: reply}});
  }

  async saveConfig() {
    const conf_req = await fetch(FLASKURL + "/api/configtoyml", {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *cors, same-origin
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      body: JSON.stringify(this.state.config) // body data type must match "Content-Type" header
    });
    const reply = await conf_req.text();
    let bl = new Blob([reply], {
        type: "text/html"
    });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(bl);
    a.download = "config.yml";
    a.hidden = true;
    document.body.appendChild(a);
    a.innerHTML =
        "abcdefg";
    a.click();
  }

  loadFile(event) {
    var file = event.target.files[0];
    var reader = new FileReader();
    reader.readAsText(file, 'UTF-8');
    reader.onload = readerEvent => {
      var content = readerEvent.target.result;
      console.log(content)
      this.loadYaml(content)
    }
  }

  async loadYaml(data) {
    const conf_req = await fetch(FLASKURL + "/api/ymltojson", {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/html'
      },
      cache: 'no-cache',
      body: data
    });
    const config = await conf_req.json();
    //const conf_req = await fetch("http://127.0.0.1:5000/api/ymltojson", {
    //  method: 'POST', // *GET, POST, PUT, DELETE, etc.
    //  mode: 'cors', // no-cors, *cors, same-origin
    //  headers: {
    //    'Content-Type': 'text/html'
    //  },
    //  cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
    //  body: data // body data type must match "Content-Type" header
    //});
    //const config = await conf_req.json();
    console.log(config)
    this.setState(state => { return {config: config, msg: "OK"}});
    this.props.onChange(config);
  }

  render() {
    return (
      <section className="sidepanel">
        <div className="sidepanelelement"><img src={camillalogo} alt="graph" width="100%" height="100%" /></div>
        <div className="sidepanelelement">
          State: {this.state.state} 
        </div>
        <div className="sidepanelelement">
          Signal range: {this.state.signalrange}
        </div>
        <div className="sidepanelelement">
          Capture samplerate: {this.state.capturerate}
        </div>
        <div className="sidepanelelement">
          Rate adjust: {this.state.rateadjust}
        </div>
        <div className="sidepanelelement">{this.state.msg}</div>
        <div className="sidepanelelement"><button data-tip="Get active config from CamillaDSP" onClick={this.fetchConfig}>Get</button></div>
        <div className="sidepanelelement"><button data-tip="Upload config to CamillaDSP" onClick={this.applyConfig}>Apply</button></div>
        <div className="sidepanelelement"><button data-tip="Save config to a local file" onClick={this.saveConfig}>Save to file</button></div>
        <div className="sidepanelelement"><input data-tip="Load config from a local file" type="file" onChange={this.loadFile}></input></div>
      </section>
    );
  }
}


    