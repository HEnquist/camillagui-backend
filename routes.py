from flask import Blueprint, render_template
from flask import Flask, request, send_file, current_app
from camilladsp.plot_pipeline import plot_pipeline
from camilladsp.plot_filters import plot_filter

view = Blueprint("view", __name__)


@view.route('/filter/<name>', methods=['GET', 'POST'])
def eval_filter(name):
    content = request.get_json(silent=True)
    # print(content) # Do your processing
    image=plot_filter((name, content), 44100, toimage=True)
    return send_file(image, mimetype='image/svg+xml')

@view.route('/pipeline', methods=['GET', 'POST'])
def eval_pipeline():
    content = request.get_json(silent=True)
    # print(content) # Do your processing
    image=plot_pipeline(content, toimage=True)
    return send_file(image, mimetype='image/svg+xml')

@view.route('/getconfig', methods=['GET', 'POST'])
def get_config():
    # print(content) # Do your processing
    cdsp = current_app.config['CAMILLA']
    config = cdsp.get_config()
    return config

@view.route('/version', methods=['GET', 'POST'])
def get_version():
    # print(content) # Do your processing
    cdsp = current_app.config['CAMILLA']
    vers_tup = cdsp.get_version()
    version = {"major": vers_tup[0], "minor": vers_tup[1], "patch": vers_tup[2]}
    return version

@view.route('/state', methods=['GET', 'POST'])
def get_state():
    # print(content) # Do your processing
    cdsp = current_app.config['CAMILLA']
    state = cdsp.get_state()
    return state