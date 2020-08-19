import yaml
import sys

from camilladsp import CamillaConnection
from matplotlib import pyplot as plt
from flask import Flask, request, send_file, current_app
#from flask_cors import CORS


def create_app(port=1234):
    app = Flask(__name__, static_url_path='')
    #cors = CORS(app, resources={r"/*": {"origins": "*"}})
    camillaconnection = CamillaConnection("127.0.0.1", port)
    camillaconnection.connect()
    app.config['CAMILLA'] = camillaconnection
    from routes import view
    app.register_blueprint(view)
    return app

def main():
    try:
        port = sys.argv[1]
    except:
        port = 1234
    app = create_app(port=port)
    app.run(host= '0.0.0.0',debug=True)

if __name__ == '__main__':
    main()
    

