# camillagui-backend — Python/aiohttp backend

AIOHTTP web server that bridges the React frontend to a running CamillaDSP instance via WebSocket. Targets CamillaDSP 5.0.x.

## Run commands (from this directory)

```sh
# Install deps (pick one)
pip install -r requirements.txt
# or: poetry install

# Start server (default port 5005)
python main.py

# Tests
pytest tests/
```

## Source layout

```
main.py                          # Entry point — creates aiohttp app, loads config, starts server
config/
  camillagui.yml                 # Server config (ports, file paths, etc.)
  gui-config.yml                 # GUI config sent to frontend

backend/
  routes.py                      # URL -> view function mapping (all /api/* routes)
  views.py                       # Request handlers (the bulk of the API logic)
  settings.py                    # Reads camillagui.yml; BASEPATH, GUI_CONFIG_PATH, etc.
  settings_schemas.py            # Pydantic/jsonschema for settings validation
  filemanagement.py              # Config/coeff file operations (load, save, rename, zip)
  filters.py                     # Filter plot option helpers
  eventstream.py                 # SSE event streaming: LevelEventStream + SpectrumEventStream
  statics.py                     # NoCacheStaticResource (serves built frontend)
  version.py                     # Backend version string
  legacy_config_import.py        # Migrates old config formats to current version
  convolver_config_import.py     # Imports Convolver project configs
  eqapo_config_import.py         # Imports EqAPO configs
  dsp/                           # Config validation + filter evaluation
    validate_config.py           # CamillaValidator — schema + semantic validation
    eval_filterconfig.py         # eval_filter / eval_filterstep
    filters.py                   # Filter implementations for evaluation
    defaults.py                  # CamillaDSP's defaults for optional parameters
    audiofileread.py             # wav header + coefficient file reading
    schemas/                     # JSON schemas for every config section

tests/                           # pytest test suite
build/                           # Place compiled frontend files here before bundling
```

## Key API routes (from routes.py)

| Method | Path | Handler |
|---|---|---|
| GET | `/api/events` | SSE stream: status + level events |
| GET | `/api/status` | CamillaDSP status JSON |
| GET | `/api/getconfig` | Active config as JSON |
| POST | `/api/setconfig` | Push config to DSP |
| GET | `/api/getconfigfile` | Config file from disk |
| POST | `/api/saveconfigfile` | Save config to disk |
| POST | `/api/evalfilter` | Filter frequency response via `backend.dsp` |
| POST | `/api/evalfilterstep` | Filter step response |
| GET | `/api/storedconfigs` | List config files |
| POST | `/api/storeconfigs` | Upload config files |
| GET | `/api/guiconfig` | Serve gui-config.yml as JSON |
| GET | `/api/capturedevices` | List available capture devices |
| GET | `/api/playbackdevices` | List available playback devices |

## Dependencies

- `pycamilladsp` — WebSocket client to talk to CamillaDSP (from `../pycamilladsp/`), editable install via `pip install -e ../pycamilladsp`
- `aiohttp` — async HTTP server
- `PyYAML` — config file parsing
- `jsonschema` — config validation
- `numpy` — required; `backend/dsp/` evaluates filters as numpy arrays throughout

`pycamilladsp-plot` used to provide validation and filter evaluation. As of CamillaDSP 5.0 it is
merged into `backend/dsp/` and deprecated as a separate library, so it must **not** be installed.

## Talking to CamillaDSP

Request/response commands go through `pycamilladsp`. The pushed subscriptions in
`backend/eventstream.py` (VU levels and spectrum) open their own websocket and repeat the
CamillaDSP 5.0 message framing, so keep `_format_command` / `_parse_reply` there in step with
`pycamilladsp/camilladsp/camillaws.py`.
