import yaml
import sys

from camilladsp import CamillaConnection
from matplotlib import pyplot as plt
from flask import Flask, request, send_file, current_app
from flask_cors import CORS


def create_app(camillaconnection):
    app = Flask(__name__)
    cors = CORS(app, resources={r"/*": {"origins": "*"}})
    app.config['CAMILLA'] = camillaconnection
    from routes import view
    app.register_blueprint(view)
    return app



if __name__ == '__main__':
    camillaconnection = CamillaConnection("127.0.0.1", 1234)
    camillaconnection.connect()
    app = create_app(camillaconnection)
    app.run(host= '0.0.0.0',debug=True)