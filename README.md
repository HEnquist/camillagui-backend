# backend server for CamillaGUI

## Setting up
Install the dependencies:
- python 3.6 or later
- numpy
- matplotlib
- aiohttp
- pycamilladsp from https://github.com/HEnquist/pycamilladsp

Clone this repo, and edit `config/camillagui.yml` if needed.
```yaml
---
camilla_host: "0.0.0.0"
camilla_port: 1234
port: 5000
```
The default has CamillaDSP running on the same machine as the backend, with the websocket server enabled at port 1234. The web interface will be served on port 5000.

Next copy the frontend from here: https://github.com/HEnquist/camillagui/actions

Click on the last successfull build, then click "build" under "Artifacts" to download a compiled version of the frontend.

Uncompress the contents of build.zip into the "build" folder. 

## Running
Start the server with:
```sh
python main.py
```

The gui should now be available at http://localhost:5000/gui/index.html


