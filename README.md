# Flask server for CamillaGUI

## Run with Flask development server
The development server of Flask can be used while experimenting, but is not meant for normal use.

Dependencies: pycamilladsp, flask, numpy, matplotlib

These instructions assume that CamillaDSP is running with websocket enabled on port 1234.

Start camillaflask with:
```sh
python camillaflask.py 1234
```

The gui is now available at http://127.0.0.1:5000/gui/index.html


## Run with Gunicorn
Gunicorn is a proper server meant for normal use.

Dependencies: python3-gunicorn (in addition to the ones listed above)

Launch the server with:
```sh
gunicorn --bind 0.0.0.0:5000 'camillaflask:create_app(port=1234)'
```

The gui is now available at http://127.0.0.1:5000/gui/index.html

