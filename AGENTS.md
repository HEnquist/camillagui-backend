# Instructions for AI coding agents

CamillaGUI is a web GUI for CamillaDSP 5.0.x. The backend is an axum server in `api/`; the
React frontend is in `frontend/`. The backend embeds the built frontend in its executable.
These rules describe the project conventions and apply to human contributions too.
Read the [Contributing](README.md#contributing) section before making changes.

## Project layout

- `api/src/`: backend routes, CamillaDSP websocket client, settings, file handling, validation,
  OpenAPI specification and embedded frontend.
- `api/api_tests/`: black-box API and GUI tests.
- `config/`: default backend and GUI configuration.
- `frontend/src/`: React application, API client, demo backend and frontend tests.
- `frontend/src/camilladsp/eval/`: browser-side filter transfer-function evaluation and fixtures.

The frontend has additional guidance in [`frontend/CLAUDE.md`](frontend/CLAUDE.md).

## Scope and project conventions

- Keep changes focused and fix problems where they originate. Do not add unrelated cleanup or
  new infrastructure.
- `/api` is internal to this frontend. When changing it, update all affected frontend callers,
  the demo backend and API/GUI tests. Remove endpoints the frontend no longer uses.
- Keep every API error as the standard JSON error body, including request parsing errors.
- Register each handler with `#[utoipa::path]` and `routes!` in `api/src/main.rs`. The committed
  OpenAPI spec and generated frontend schema must stay in sync. After changing a handler or a type
  used in the spec, run:

  ```sh
  (cd api && UPDATE_OPENAPI=1 cargo test committed_spec_is_current)
  (cd frontend && npm run generate-api)
  ```

- Config types, validation, coefficient reading and the websocket protocol come from
  `camilladsp-schema`. Fix schema validation issues there, rather than working around them here.
- Keep the project free of C dependencies; static Linux builds rely on that.
- Update directly related documentation and tests when behavior changes.

## Development and validation

For frontend hot reload, run `npm run dev` from `frontend/` and the backend with `cargo run`
from `api/`. The frontend dev server proxies `/api` to the backend on port 5005.

Run relevant checks for the files changed:

```sh
(cd api && cargo test)
(cd api && cargo clippy --all-targets -- -D warnings)
(cd frontend && npm run check)
(cd frontend && npm test -- --run)
```

The black-box tests use a fake CamillaDSP and run from the repository root:

```sh
python -m pytest api/api_tests
```

They require `pytest`, `aiohttp` and `PyYAML`; GUI tests also require Playwright.
