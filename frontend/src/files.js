import React, {Component} from "react";
import {FLASKURL} from "./index";

export class Files extends Component {

  constructor(props) {
    super(props);
      this.uploadConfig = this.uploadConfig.bind(this);
      this.uploadCoeff = this.uploadCoeff.bind(this);
  }

  async uploadConfig(event) {
    const file = event.target.files[0];
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
    const file = event.target.files[0];
    const formData = new FormData();
    formData.append("contents", file, file.name);
    await fetch(FLASKURL + "/api/uploadcoeff", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      //mode: 'same-origin', // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      body: formData, // body data type must match "Content-Type" header
    });
  }

  render() {
    return (
      <div className="space-between-children">
        <div>
          Upload a config file
          <input
            className="fileinput"
            data-tip="Upload a config file"
            type="file"
            onChange={this.uploadConfig}
          />
        </div>
        <div>
          Upload a coefficient file
          <input
            className="fileinput"
            data-tip="Upload a coefficient file"
            type="file"
            onChange={this.uploadCoeff}
          />
        </div>
      </div>
    );
  }
}