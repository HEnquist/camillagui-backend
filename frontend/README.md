CamillaGUI frontend
---

This is the frontend of  CamillaGUI, the part that runs in the browser and handles the actual interface.

The backend is located here: https://github.com/HEnquist/camillagui-backend

For instructions on how to set the gui up, see the readme for the backend.

## Dependencies
The gui is based on the [React](https://react.dev/) framework.
It uses the [npm](https://www.npmjs.com/) package manager,
and the [Vite](https://vitejs.dev/) development environment.

It uses a number of open source libraries and components.
See `package.json` for the full list.

## Development
Select the frontend Node version with `nvm use`.

Install the dependencies with `npm install`.

Start the development server with `npm run dev`.
This makes the GUI available on `http://localhost:5173/gui`.
The development server watches for changes in the source files
and updates the running version automatically.

For a frontend-only demo build that can be deployed to GitHub Pages,
use `npm run dev:demo` for local development or `npm run build:demo` for a production build.
That mode installs an in-browser mock backend only when the `demo` Vite mode is selected,
so the normal backend integration remains unchanged.

## Demo deployment
The repository includes a manual GitHub Actions workflow for publishing the standalone demo to GitHub Pages.
It builds the existing `build:demo` target and deploys the generated `build` folder without committing artifacts to a publish branch.

Use the `Deploy demo to GitHub Pages` workflow from the Actions tab.
Provide a `ref` value and choose a deployment `channel`:

- Use a release tag such as `v4.1.0` with the `release` channel when you want the public demo to match a released version.
- Use a branch such as `master` or a release-prep branch with the `preview` channel when you want to publish an upcoming version for review.

Each deployment replaces the current GitHub Pages site for this repository.
That makes it easy to switch between the latest released demo and an in-progress preview by rerunning the workflow with a different ref.

Before the first deployment, configure the repository Pages settings to use GitHub Actions as the source.

To make a production build, run `npm run build`.
The build will be stored in the `build` folder.
After building, the production build can be previewed with `npm run serve`.
Note that this preview is not automatically updated
when source files change, it must be manually update with `npm run build`.

Tests are executed by running `npm test`.

## Custom pages

You can add new tabs to the GUI without modifying the core code. Create a `.tsx` file in
`src/custom-pages/`, then rebuild. The new tab appears automatically after the built-in tabs.

See [`src/custom-pages/README.md`](src/custom-pages/README.md) for the full reference.

