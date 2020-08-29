# Backend server for CamillaGUI

This is the server part of CamillaGUI, a web-based GUI for CamillaDSP.

The complete GUI is made up of two parts:
- a frontend based on React: https://reactjs.org/ 
- a backend based on AIOHTTP: https://docs.aiohttp.org/en/stable/

## Setting up
Install the dependencies:
- python 3.6 or later
- numpy
- matplotlib
- aiohttp
- pycamilladsp from https://github.com/HEnquist/pycamilladsp

Go to "Releases": https://github.com/HEnquist/camillagui-backend/releases
Download the zip-file ("camillagui.zip") for the latest release. This includes both the backend and the frontend.

Unzip the file, and edit `config/camillagui.yml` if needed.

```yaml
---
camilla_host: "0.0.0.0"
camilla_port: 1234
port: 5000
```
The included configuration has CamillaDSP running on the same machine as the backend, with the websocket server enabled at port 1234. The web interface will be served on port 5000. It is possible to run the gui and CamillaDSP on different machines, just point the `camilla_host` to the right address.


## Running
Start the server with:
```sh
python main.py
```

The gui should now be available at: http://localhost:5000/gui/index.html

If accessing the gui from a different machine, replace "localhost" by the IP or hostname of the machine running the gui server.


