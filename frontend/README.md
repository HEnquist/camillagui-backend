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
Install the dependencies with `npm install`.

Start the development server with `npm run dev`.
This makes the GUI available on `http://localhost:5173/gui`.
The development server watches for changes in the source files
and updates the running version automatically.

To make a production build, run `npm run build`.
The build will be stored in the `dist` folder.
After building, the production build can be previewed with `npm run serve`.
Note that this preview is not automatically updated
when source files change, it must be manually update with `npm run build`.

Tests are executed by running `npm test`.

