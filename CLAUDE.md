# camillagui-backend — the CamillaGUI backend and frontend

The web GUI for CamillaDSP. Targets CamillaDSP 5.0.x.

- `rust/` is the backend: an axum server that bridges the browser to a running CamillaDSP over
  its websocket, serves the config, coefficient and audio file folders, and embeds the frontend
  build in the binary. It replaced the Python backend for 5.0.
- `frontend/` is the React frontend, with its own `frontend/CLAUDE.md`. It was a separate
  repository (HEnquist/camillagui) until 5.0, merged in with its full history, every old commit
  rewritten to sit under `frontend/`, so `git log` and `git blame` work without `--follow`.
- The Python backend it replaced was removed after the port. Check out a commit before
  "Remove the Python backend" to run the parity tests against it.

## Run commands

```sh
# Frontend: build it first, the backend embeds frontend/build at compile time
cd frontend && npm ci && npm run build

# Backend (from rust/)
cargo build                      # or --release
cargo test
cargo clippy --all-targets -- -D warnings
./target/debug/camillagui -c ../config/camillagui.yml -l debug

# Frontend dev server on :5173, proxying /api to :5005, see frontend/CLAUDE.md
cd frontend && npm run dev

# Black-box API tests against the backend process and a fake CamillaDSP (from the repo root),
# plus GUI tests in headless Chromium against the frontend in frontend/build (build it first).
# The GUI tests are skipped without Playwright, see rust/api_tests/conftest.py to install it.
.venv/bin/python -m pytest rust/api_tests
```

## Source layout (rust/src)

```
main.rs        routes, startup, the file folders as static files
api.rs         the /api handlers, the counterpart of the old views.py
camilla.rs     typed client for CamillaDSP's websocket, on camilladsp_config::protocol
status.rs      the /api/status cache; device and backend lists, read on reconnect
events.rs      SSE out: VU levels, spectrum and state, one CamillaDSP subscription per open stream
validate.rs    validation with camilladsp-config, plus the GUI's device type rules
settings.rs    camillagui.yml and gui-config.yml
paths.rs       resolving, relativizing and policing coefficient and audio paths
files.rs       folder listings, uploads, renames, zips, the statefile
legacy.rs      identifying and migrating configs for older CamillaDSP versions
convolver.rs   Convolver config import
eqapo.rs       Equalizer APO config import
coeffs.rs      /api/convcoeffs framing, coefficient defaults, $samplerate$ options
wav.rs         wav headers
yaml.rs        YAML to JSON values, with NaN/infinity detection
gui.rs         the embedded frontend, and the css-variables.css override
filter_variants.rs  tests only: the frontend's filter fixture against camilladsp-config
```

`config/` holds the default `camillagui.yml` and `gui-config.yml`. A release ships them in
`config/` next to the binary, which is where the binary looks by default. A
`css-variables.css` placed there by the user is served in place of the embedded one; the
release does not ship one, so an upgrade always brings the current stylesheet.

## The API is internal

`/api` exists for this frontend only, it is not a public API. Change it freely when that makes
the GUI simpler or cheaper, and change the frontend, the demo backend
(`frontend/src/demo/mockBackend.ts`) and the API and GUI tests in `rust/api_tests` with it.
Most responses still have the old Python backend's shape, down to quirks like `getparam/mute`
answering `True`/`False`, only because the port kept the frontend unchanged.

Two things to keep in mind:
- serde_json widens an f32 to f64 when it builds a `Value`, so 0.2 becomes 0.20000000298023224.
  Anything CamillaDSP sends as f32 goes through `camilla::to_json`, which keeps the short form.
- POST bodies are parsed from raw bytes, since the frontend does not always send a content type.

## camilladsp-config

Config types, validation, coefficient reading and the websocket protocol all come from the
`camilladsp-config` crate in the camilladsp repository, so the GUI checks configs with exactly the
code the DSP runs. Until it is published with CamillaDSP 5.0 it is a git dependency on the
`config_crate` branch, pinned by `Cargo.lock`; see the comment in `rust/Cargo.toml` for building
against a local checkout. Fix validation problems there, not here.

Device types: a type is allowed if the connected CamillaDSP lists it (`GetSupportedDeviceTypes`,
read on every reconnect), narrowed by `supported_*_types` in the settings. Only before CamillaDSP
has been reached does this build's own platform decide.

No C dependencies anywhere in the tree. Keep it that way, it is what lets every Linux target
build as a static musl binary with cargo-zigbuild from one CI runner.

## Filter evaluation lives in the frontend

Filter transfer functions are evaluated in the browser, in `frontend/src/camilladsp/eval/`. The
backend only resolves a Conv filter's file, applies the `$samplerate$` and `$channels$` tokens,
and returns the samples, framed as binary rather than JSON (see `coeffs::frame_coefficients`).

`frontend/src/camilladsp/eval/fixtures/variants.json` holds a case for every filter type,
subtype and optional parameter, for the frontend's `variants.test.ts`. It is edited by hand.
`rust/src/filter_variants.rs` destructures every filter type without `..`, so anything new in
camilladsp-config fails to compile there, and its tests fail until the fixture covers it.
