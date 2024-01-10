# Backend server for CamillaGUI

This is the server part of CamillaGUI, a web-based GUI for CamillaDSP.

This version works with CamillaDSP 2.0.x.

The complete GUI is made up of two parts:
- a frontend based on React: https://reactjs.org/
- a backend based on AIOHTTP: https://docs.aiohttp.org/en/stable/

## Setting up
### Install gui server
Go to "Releases": https://github.com/HEnquist/camillagui-backend/releases
Download the zip-file ("camillagui.zip") for the latest release. This includes both the backend and the frontend.

Unzip the file and edit `config/camillagui.yml` as needed, see [Configuration](#configuration).

### Python dependencies
The Python dependencies are listed in three different files,
for use with different Python package/environment managers.
- `cdsp_conda.yml` for [conda](https://conda.io/).
- `requirements.txt` for [pip](https://pip.pypa.io/), often combined with an environment manager such as [venv](https://docs.python.org/3/library/venv.html).
- `pyproject.toml` for [Poetry](https://python-poetry.org).


### Prepare the Python environment
The easiest way to get the Python environment prepared is to use the setup scripts from
[camilladsp-setupscripts](https://github.com/HEnquist/camilladsp-setupscripts).

If doing a manual installation, there are many ways of installing Python and setting up environments.
Please see the [documentation for pycamilladsp](https://henquist.github.io/pycamilladsp/install/#installing)
for more information.


## Configuration

The backend configuration is stored in `config/camillagui.yml`

```yaml
---
camilla_host: "0.0.0.0"
camilla_port: 1234
bind_address: "0.0.0.0"
port: 5005
config_dir: "~/camilladsp/configs"
coeff_dir: "~/camilladsp/coeffs"
default_config: "~/camilladsp/default_config.yml"
statefile_path: "~/camilladsp/statefile.yml"
log_file: "~/camilladsp/camilladsp.log" (*, defaults to null)
on_set_active_config: null (*)
on_get_active_config: null (*)
supported_capture_types: null (*)
supported_playback_types: null (*)
```
The options marked `(*)` are optional. If left out the default values listed above will be used. The included configuration has CamillaDSP running on the same machine as the backend, with the websocket server enabled at port 1234. The web interface will be served on port 5005. It is possible to run the gui and CamillaDSP on different machines, just point the `camilla_host` to the right address.

**Warning**: By default the backend will bind to all network interfaces. This makes the gui available on all networks the system is connected to, which may be insecure. Make sure to change the `bind_address` if you want it to be reachable only on specific network interface(s) and/or to set your firewall to block external (internet) access to this backend.

The settings for config_dir and coeff_dir point to two folders where the backend has permissions to write files. This is provided to enable uploading of coefficients and config files from the gui.

If you want to be able to view the log file in the GUI, configure CamillaDSP to log to `log_file`.

### Active config file
The active config file path is memorized via the CamillaDSP state file.
Set the `statefile_path` to point at the statefile that the CamillaDSP process uses.
For this to work, CamillaDSP must be running with a statefile.
That is achieved by starting it with the `-s` parameter, giving the same path to the statefile as in `camillagui.yml`:
```sh
camilladsp -p 1234 -w -s /path/to/statefile.yml
```

If the CamillaDSP process is running, the active config file path will be fetched by querying the running process.
If its not running, it will instead be read directly from the statefile.

The active config will be loaded into the web interface when it is opened.
If there is no active config, the `default_config` will be used.
If this does not exist, the internal default config is used.
Note: the active config will NOT be automatically applied to CamillaDSP, when the GUI starts.

See also [Integrating with other software](#integrating-with-other-software)


### Limit device types
By default, the config validator allows all the device types that CamillaDSP can support. To limit this to the types that are supported on a particular system, give the list of supported types as: 
```yaml
supported_capture_types: ["Alsa", "File", "Stdin"]
supported_playback_types: ["Alsa", "File", "Stdout"]
```

### Integrating with other software
If you want to integrate CamillaGUI with other software,
there are some options to customize the UI for your particular needs.

#### Setting and getting the active config
_NOTE: This functionality is experimental, there may be significant changes in future versions._

The configuration options `on_set_active_config` and `on_get_active_config` can be used to customize the way the active config file path is stored.
These are shell commands that will be run to set and get the active config.
Setting these options will override the normal way of getting and setting the active config path.
Since the commands are run in the operating system shell, the syntax depends on which operating system is used.
The examples given below are for Linux.

The `on_set_active_config` uses Python string formatting to insert the filename.
This means it must contain an empty set of curly brackets, where the filename will get inserted surrounded by quotes.

Examples:
- Running a script: `on_set_active_config: my_updater_script.sh {}`
  
  The backend will run the command: `my_updater_script.sh "/full/path/to/new_active_config.yml"`
- Saving config filename to a text file: `on_set_active_config: echo {} > active_configname.txt` 

  The backend will run the command: `echo "/full/path/to/new_active_config.yml" > active_configname.txt`

The `on_get_active_config` command is expected to return a filename on stdout.
As an example, read a filename from a text file: `on_get_active_config: "cat myconfig.txt"`.

#### Styling the GUI
The UI can be styled by editing `build/css-variables.css`.
Further instructions on how to do this, or switch back to the brighter black/white UI, can be found there.

#### Hiding GUI Options
Options can hidden from your users by editing `config/gui-config.yml`.
Setting any of the options to `true` hides the corresponding option or section.
These are all optional, and default to `false` if left out.
```yaml
hide_capture_samplerate: false
hide_silence: false
hide_capture_device: false
hide_playback_device: false
hide_rate_monitoring: false
```

#### Other GUI Options
Changes to the currently edited config can be applied automatically, but this behavior is disabled by default.
To enable it by default, in `config/gui-config.yml` set `apply_config_automatically` to `true`.

The update rate of the level meters can be adjusted by changing the `status_update_interval` setting. 
The value is in milliseconds, and the default value is 100 ms.

## Running
Start the server with:
```sh
python main.py
```

The gui should now be available at: http://localhost:5005/gui/index.html

If accessing the gui from a different machine, replace "localhost" by the IP or hostname of the machine running the gui server.


## Development
### Render the environment files
This repository contains [jinja](https://palletsprojects.com/p/jinja/) templates used to create the Python environment files.
The templates are stored in `release_automation/templates/`.

To render the templates, install the dependencies `PyYAML` and `jinja2` and run the Python script `render_env_files.py`:
```sh
python -m release_automation.render_env_files
```
When rendering, the versions of the Python dependencies are taken from the file `release_automation/versions.yml`.
The backend version is read from `backend/version.py`.

### Running the tests

```sh
python -m unittest discover -p "*_test.py"
```
