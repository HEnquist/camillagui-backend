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
  dsp/                           # Config validation
    validate_config.py           # CamillaValidator — schema + semantic validation
    defaults.py                  # CamillaDSP's defaults for optional parameters
    audiofileread.py             # wav header + coefficient file reading
    schemas/                     # JSON schemas for every config section

tools/
  dump_filter_variants.py        # Exports every schema-valid filter to the frontend's test fixture

tests/                           # pytest test suite
build/                           # Place compiled frontend files here before bundling
```

## Filter evaluation lives in the frontend

There is no DSP in this backend. Filter transfer functions are evaluated in the browser, in
`camillagui/src/camilladsp/eval/`, which is both faster (the GUI is usually browsed from a laptop
while the backend runs on an SBC) and one implementation instead of two. The backend keeps only
what needs a server: `POST /api/convcoeffs` resolves a Conv filter's path, applies the
`$samplerate$` and `$channels$` tokens, and returns the decoded coefficients.

**The one thing to watch:** the JSON schemas are here, in Python, while the evaluator is over
there, in TypeScript. `tools/dump_filter_variants.py` exports every schema-valid filter config to
`camillagui/src/camilladsp/eval/fixtures/variants.json`, and the frontend's `variants.test.ts`
evaluates all of them. **When you change a filter schema, re-run that tool and commit the result**,
or the evaluator gets a new parameter with nothing testing it. `tests/test_eval_validated_configs.py`
fails until you do.

The numbers themselves are covered by `properties.test.ts` over there, which asserts closed-form
properties rather than captured curves, so it does not depend on this backend having been right.

## Key API routes (from routes.py)

| Method | Path | Handler |
|---|---|---|
| GET | `/api/events` | SSE stream: status + level events |
| GET | `/api/status` | CamillaDSP status JSON |
| GET | `/api/getconfig` | Active config as JSON |
| POST | `/api/setconfig` | Push config to DSP |
| GET | `/api/getconfigfile` | Config file from disk |
| POST | `/api/saveconfigfile` | Save config to disk |
| POST | `/api/convcoeffs` | Coefficients of a file-backed Conv filter, for the frontend to evaluate |
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
- `numpy` — required; `audiofileread.py` decodes coefficients with `np.fromfile` and a view-and-shift
  trick for 24-bit, and `validate_config.diffeq_is_stable` uses `np.roots`

`pycamilladsp-plot` used to provide validation and filter evaluation. As of CamillaDSP 5.0 the
validation is merged into `backend/dsp/` and the library is deprecated, so it must **not** be
installed. The evaluation went to the frontend instead, see above.

## Talking to CamillaDSP

Request/response commands go through `pycamilladsp`. The pushed subscriptions in
`backend/eventstream.py` (VU levels and spectrum) open their own websocket and repeat the
CamillaDSP 5.0 message framing, so keep `_format_command` / `_parse_reply` there in step with
`pycamilladsp/camilladsp/camillaws.py`.
