# Backend server for CamillaGUI

This is the server part of CamillaGUI, a web-based GUI for CamillaDSP.

This version works with CamillaDSP 5.0.x.

The complete GUI is made up of two parts, both in this repository:
- a frontend based on React: https://reactjs.org/, in the `frontend` directory
- a backend written in Rust, in the `api` directory

The backend is a single executable with the frontend built into it.
It validates configs with the same code as CamillaDSP itself.

## Download
Go to "Releases": https://github.com/HEnquist/camillagui-backend/releases
Download the archive for your system, for example `camillagui_linux_amd64.tar.gz`
for a Linux system running an AMD or Intel cpu.
The Linux executables are statically linked, so they run on any distribution.

Uncompress the archive to a directory of your choice.
It contains the executable `camillagui` (`camillagui.exe` on Windows)
and a `config` directory with its settings.
A suggestion is to create a directory named `camilladsp`
in your home directory, and uncompress the archive into a directory named `camillagui` in it.
Also create directories named `configs`, `coeffs` and `audiofiles` in the `camilladsp` directory.
The gui starts without them, but warns, and has nowhere to store those files until they exist.

The settings are in `config/camillagui.yml`, next to the executable.
See [Configuration](#configuration) for an explanation of the options.
The default settings use the `configs`, `coeffs` and `audiofiles` directories
created above, but these locations can be changed by editing the file.

Upgrading from 4.x: the backend no longer needs Python.
The settings file has the same format, so an existing `camillagui.yml` can be copied over.
A customized `build/css-variables.css` can be copied to `config/css-variables.css`,
see [Styling the GUI](#styling-the-gui).


## Configuration

The backend configuration is stored in `config/camillagui.yml`, next to the executable.
A different file can be given with the `--config` command line option.

Example:
```yaml
---
camilla_host: "0.0.0.0"
camilla_port: 1234
bind_address: "0.0.0.0"
port: 5005
gui_config_file: null (*)
config_dir: "~/camilladsp/configs"
coeff_dir: "~/camilladsp/coeffs"
default_config: "~/camilladsp/default_config.yml"
statefile_path: "~/camilladsp/statefile.yml"
log_file: "~/camilladsp/camilladsp.log" (*, defaults to null)
on_set_active_config: null (*)
on_get_active_config: null (*)
supported_capture_types: null (*)
supported_playback_types: null (*)
level_smoothing_ms: 200 (*)
level_max_update_hz: 30 (*)
allow_absolute_paths: false (*)
```
The options marked `(*)` are optional. If left out the default values listed above will be used.
The included configuration has CamillaDSP running on the same machine as the backend,
with the websocket server enabled at port 1234.
The web interface will be served on port 5005 using plain HTTP.
It is possible to run the gui and CamillaDSP on different machines,
just point the `camilla_host` to the right address.

The optional `gui_config_file` can be used to override the default path to the gui config file,
`gui-config.yml` in the same directory as `camillagui.yml`.

**Warning**: By default the backend will bind to all network interfaces.
This makes the gui available on all networks the system is connected to, which may be insecure.
Make sure to change the `bind_address` if you want it to be reachable only on specific
network interface(s) and/or to set your firewall to block external (internet) access to this backend.

### HTTPS
The backend serves plain HTTP. For HTTPS, put a reverse proxy such as nginx or Caddy in front of it,
and set `bind_address: "127.0.0.1"` so that the backend itself is only reachable through the proxy.

The `ssl_certificate` and `ssl_private_key` options of earlier versions are gone.
The backend refuses to start if they are set, rather than quietly serving plain HTTP.

With [Caddy](https://caddyserver.com), this is a complete `Caddyfile`.
`tls internal` makes Caddy create its own certificate authority and certificate:
```
camilladsp.local {
    tls internal
    reverse_proxy 127.0.0.1:5005
}
```

With nginx, and a certificate and key of your own:
```nginx
server {
    listen 443 ssl;
    server_name camilladsp.local;
    ssl_certificate     /path/to/my_certificate.crt;
    ssl_certificate_key /path/to/my_private_key.key;
    # Uploaded wav and coefficient files can be large
    client_max_body_size 1g;

    location / {
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header Host $host;
    }
}
```
The level meters use a server-sent event stream.
The backend tells nginx not to buffer it, so no further settings are needed for that.

To generate a self-signed certificate and key pair, use openssl:
```sh
openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout my_private_key.key -out my_certificate.crt
```

### Folders
The settings for config_dir and coeff_dir point to two folders where the backend has permissions to write files.
This is provided to enable uploading of coefficients and config files from the gui.

### File path security

By default (`allow_absolute_paths: false`), a coefficient or audio file must end up inside `coeff_dir`
or `audiofiles_dir` respectively. What matters is where a path points, not how it is written:

- A bare filename is resolved against `coeff_dir` or `audiofiles_dir`, so it is always accepted.
- A relative path is resolved the way CamillaDSP resolves it, coefficient paths against the directory
  the config is in and audio paths against `audiofiles_dir`. A config in `configs/` referring to
  `../coeffs/filter.raw` is therefore accepted, since it lands in `coeff_dir`, while
  `../../../etc/passwd` is not.
- An absolute path is accepted only if it is inside the configured directory.

Config files on disk always store absolute paths so that CamillaDSP can use them at startup without the GUI.

This prevents anyone with GUI access from reading arbitrary files from the filesystem via the coefficient
or audio file fields. With absolute paths allowed, anyone with GUI access can read any file on the system
and write to any location the DSP process has write access to.
The risk is especially serious if the CamillaDSP process runs with elevated privileges — running it as root
is strongly discouraged and should be avoided. A dedicated low-privilege user account is the right approach.

**Upgrading from an older version:** if your configs reference coefficient or audio files that sit outside
the configured directories, the GUI will reject them until you either:
- Move the files into `coeff_dir` / `audiofiles_dir` and use bare filenames (recommended), or
- Set `allow_absolute_paths: true` in `camillagui.yml` to restore the previous behaviour

Setting `allow_absolute_paths: true` disables all path validation and is not recommended.
Only use it as a last resort if migrating to bare filenames is not practical,
and only if you fully trust everyone who can reach the GUI.

If you want to be able to view the log file in the GUI, configure CamillaDSP to log to `log_file`.

The `level_smoothing_ms` and `level_max_update_hz` options control the VU meter event stream.
`level_smoothing_ms` sets the release time constant in milliseconds, and also sets the attack
time constant to one tenth of that value.
`level_max_update_hz` sets the maximum event rate from CamillaDSP to the GUI.
Lower values reduce CPU usage and network traffic, while higher values make the meters respond faster.

### Active config file
The active config file path is memorized via the CamillaDSP state file.
Set the `statefile_path` to point at the statefile that the CamillaDSP process uses.
For this to work, CamillaDSP must be running with a statefile.
That is achieved by starting it with the `-s` parameter,
giving the same path to the statefile as in `camillagui.yml`:
```sh
camilladsp -p 1234 -w -s /path/to/statefile.yml
```

If the CamillaDSP process is running, the active config file path
will be fetched by querying the running process.
If its not running, it will instead be read directly from the statefile.

The active config will be loaded into the web interface when it is opened.
If there is no active config, the `default_config` will be used.
If this does not exist, the internal default config is used.
Note: the active config will NOT be automatically applied to CamillaDSP, when the GUI starts.

See also [Integrating with other software](#integrating-with-other-software)


### Limit device types
The config validator allows the device types that the connected CamillaDSP was built with.
To limit this further, give the list of types to allow as:
```yaml
supported_capture_types: ["Alsa", "RawFile", "Stdin"]
supported_playback_types: ["Alsa", "File", "Stdout"]
```
These lists also limit the device types offered in the GUI.

### Integrating with other software
If you want to integrate CamillaGUI with other software,
there are some options to customize the UI for your particular needs.

#### Setting and getting the active config
_NOTE: This functionality is experimental, there may be significant changes in future versions._

The configuration options `on_set_active_config` and `on_get_active_config` can be used to customize
the way the active config file path is stored.
These are shell commands that will be run to set and get the active config.
Setting these options will override the normal way of getting and setting the active config path.
Since the commands are run in the operating system shell, the syntax depends on which operating system is used.
The examples given below are for Linux.

The `on_set_active_config` must contain an empty set of curly brackets, `{}`,
which is replaced by the filename surrounded by quotes.

Examples:
- Running a script: `on_set_active_config: my_updater_script.sh {}`

  The backend will run the command: `my_updater_script.sh "/full/path/to/new_active_config.yml"`
- Saving config filename to a text file: `on_set_active_config: echo {} > active_configname.txt`

  The backend will run the command: `echo "/full/path/to/new_active_config.yml" > active_configname.txt`

The `on_get_active_config` command is expected to return a filename on stdout.
As an example, read a filename from a text file: `on_get_active_config: "cat myconfig.txt"`.


## Customizing the GUI
Some functionality of the GUI can be customized by editing `config/gui-config.yml`.
The styling can be customized with a `config/css-variables.css`, see [Styling the GUI](#styling-the-gui).

### GUI title
Change the GUI title by setting `page_title`.
This helps distinguish multiple CamillaDSP instances on the network,
for example "Living room" and "Headphone system".
This will be shown as the page title in the browser,
making it easy to identify which GUI controls which setup.

### Volume control range
The range of the volume control slider can be customized by changing
the valkues of `volume_range` and `volume_max`.
The default values are a range of 50 dB and a maximum of 0 dB.

### Adding custom shortcut settings
It is possible to configure custom shortcuts for the `Shortcuts` section and the compact view.
The included config file contains the default Bass and Treble filters,
as well as a few commented out examples.

To add more, edit the file `config/gui-config.yml` to add
the new shortcuts to the list under `custom_shortcuts`.

Here is an example config to set the gain of the filters called `MyFilter` and `MyOtherFilter`.
within the range from -10 to 0 db in steps of 0.1 dB.
For `MyOtherFilter`, the scale is reversed, such that moving the slider from -10 to -9 dB
changes the gain of `MyOtherFilter` fom 0 to -1 dB.
The `type` property is set to `number`.
This creates a slider control, used to control numerical values.
It can also be set to `boolean` which creates a checkbox.
For `number`, the `range_from`, `range_to` and `step` properties are required.
They are not used by `boolean` controls and may be left out.

```yaml
custom_shortcuts:
  - section: "My custom section"
    description: |
      Optional description for the section.
      Omit this attribute, if unwanted.
      The text will be shown in the gui with line breaks.
    shortcuts:
      - name: "My filter gain"
        description: |
          Optional description for the setting.
          Omit this attribute, if unwanted.
        config_elements:
          - path: ["filters", "MyFilter", "parameters", "gain"]
            reverse: false
          - path: ["filters", "MyOtherFilter", "parameters", "gain"]
            reverse: true
        range_from: -10
        range_to: 0
        step: 0.1
        type: "number"
```
When letting a shortcut control more than one element in the config,
the first one is considered the main one, that controls the slider position.
The first element must be present in the config in order for the shortcut to function.

If any of the others is not at the expected value, the GUI will show a warning.
The same happens if any of the others is missing in the config.
The control can then still be used, but may not give the wanted result.

### Hiding GUI Options
Options can be hidden from your users by editing `config/gui-config.yml`.
Setting any of the options to `true` hides the corresponding option or section.
These are all optional, and default to `false` if left out.
```yaml
hide_capture_samplerate: false
hide_silence: false
hide_capture_device: false
hide_playback_device: false
hide_rate_monitoring: false
hide_multithreading: false
```

### Styling the GUI
The stylesheet is built into the backend, and the release does not include a copy.
To restyle the UI, save the built-in one as `config/css-variables.css` and edit it there.
With the GUI running, download it from `http://<host>:5005/gui/css-variables.css`, for example:
```sh
curl -o config/css-variables.css http://localhost:5005/gui/css-variables.css
```
The backend serves this file in place of the built-in one whenever it exists.
Further instructions on how to edit it, or switch back to the brighter black/white UI,
can be found in the file itself.
Delete it to go back to the built-in one.
After an upgrade, a customized file keeps being used,
so compare it with the new built-in one to pick up any new variables.

### Other GUI Options
Changes to the currently edited config can be applied automatically, but this behavior is disabled by default.
To enable it by default, in `config/gui-config.yml` set `apply_config_automatically` to `true`.

The `status_update_interval` setting controls how often the GUI updates general
CamillaDSP status such as state, samplerate, load, and version information.
The value is in milliseconds, and the default value is 500 ms.

The VU meters are updated separately from the rest of the status display.
Their update rate and smoothing are controlled by the backend settings `level_max_update_hz`
and `level_smoothing_ms` in `config/camillagui.yml`.

### Gui config syntax check
The gui config is checked when the backend starts, and any problems are logged.
For example, a shortcut of type `number` needs `range_from`, `range_to` and `step`.
If one is missing, the whole file is ignored and this is logged:
```
ERROR camillagui::settings] Error in config file '/path/to/gui-config.yml': Parameter 'custom_shortcuts': a number shortcut needs 'range_from', 'range_to' and 'step'
```

## Running
Start the server by running the executable.
Linux and macOS:
```sh
./camillagui
```
Windows:
```sh
camillagui.exe
```
On Windows it is also possible to start it by double-clicking the .exe-file.

The gui should now be available at: http://localhost:5005/gui/index.html

If accessing the gui from a different machine, replace "localhost" by the IP
or hostname of the machine running the gui server.

### Command line options
The logging level is `warn` by default.
It can be changed with a command line argument, which may be useful when debugging some problem.

The backend normally reads its settings from `config/camillagui.yml` next to the executable.
A different file can be given as a command line argument.

Use the `-h` or `--help` argument to view the built-in help:
```
> ./camillagui --help
Backend for the CamillaDSP web GUI

Usage: camillagui [OPTIONS]

Options:
  -c, --config <CONFIG>        The backend config file. Defaults to config/camillagui.yml next to the executable
  -l, --log-level <LOG_LEVEL>  Logging level: error, warn, info, debug or trace [default: warn]
  -h, --help                   Print help
  -V, --version                Print version
```


## Development
### Building
The backend embeds the frontend, so build that first:
```sh
cd frontend && npm ci && npm run build
cd ../api && cargo build --release
```
The executable is then `api/target/release/camillagui`.
There are no C dependencies, so cross compiling needs no C toolchain for the target.
The releases are built with [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild),
which links static Linux executables against musl.

### Running the tests
```sh
cd api && cargo test
```

The API tests in `api/api_tests` run the backend as a separate process against a fake CamillaDSP,
and need Python with `pytest`, `aiohttp` and `PyYAML`:
```sh
python -m pytest api/api_tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
