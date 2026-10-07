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
extract.rs     axum's Json, Query and Path, with rejections as JSON error bodies
openapi.rs     the spec of the typed routes, served at /api/openapi.json, and its check test
camilla.rs     typed client for CamillaDSP's websocket, on camilladsp_config::protocol
status.rs      the /api/status cache; device and backend lists, read on reconnect
events.rs      SSE out: VU levels, spectrum and state, one CamillaDSP subscription per open stream
validate.rs    validation with camilladsp-config, plus the GUI's device type rules
settings.rs    camillagui.yml, and gui-config.yml as the GuiConfig the frontend gets
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
An endpoint the frontend does not call is deleted rather than kept.

Every error is a JSON `ErrorBody`: a `message`, and `result` when CamillaDSP refused a command.
That holds for requests that do not parse too, since the extractors in `extract.rs` turn axum's
rejections into the same body.

Every handler has `#[utoipa::path]` and is registered with `routes!` in `main.rs`, which puts it
in the OpenAPI spec. The spec is committed as `rust/openapi.json`, and the frontend generates
`frontend/src/api/schema.ts` from it, both its API types and its config types. After changing a
handler, a type it uses or a type in camilladsp-config:

```sh
cd rust && UPDATE_OPENAPI=1 cargo test committed_spec_is_current   # rewrite rust/openapi.json
cd frontend && npm run generate-api                                # rewrite src/api/schema.ts
```

`cargo test` fails while `openapi.json` is stale, and CI fails while `schema.ts` is.

Things to keep in mind:
- serde_json widens an f32 to f64 when it builds a `Value`, so 0.2 becomes 0.20000000298023224.
  Anything CamillaDSP sends as f32 goes through `camilla::to_json`, which keeps the short form.
- Handlers take `Json`, `Query`, `Path` and `Multipart` from `extract.rs`, not from axum. `Json`
  needs `Content-Type: application/json`, which openapi-fetch always sends.
- An `Option` field that is left out when `None`, rather than sent as null, gets
  `#[schema(nullable = false)]`, so the frontend type is `T | undefined` and not `T | null`.
- Binary bodies (zips, `/api/convcoeffs`) are described with `inline(Binary)`; a `Vec<u8>` would
  come out as an array of numbers. Uploads are `multipart/form-data` with a `files` field per file.
- Configs go in and out as camilladsp-config's `Configuration`. The path rewriting in `paths.rs`
  still works on JSON values, so a config is turned into one with `camilla::to_json` and parsed
  back with `validate::parse`. `validateconfig` is the one handler that takes a `Value`, while its
  spec says `Configuration`: a config that does not parse is reported as an issue like any other.
- Imports answer a `ConfigFragment`, whose `DevicesFragment` has every field of camilladsp-config's
  `Devices`, all optional. A test in `api.rs` destructures `Devices` without `..`, so a field added
  there fails to compile until the fragment has it.

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
