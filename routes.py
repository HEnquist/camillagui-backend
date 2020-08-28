from flask import Blueprint, render_template
from flask import Flask, request, send_file, current_app, send_from_directory
from camilladsp import plot_pipeline, plot_filter, CamillaError
import yaml

view = Blueprint("view", __name__)

@view.route('/gui/<path:path>')
def send_static(path):
    print("get", path)
    return send_from_directory('build', path)

@view.route('/api/getparam/<name>', methods=['GET', 'POST'])
def get_param(name):
    name = name.lower()
    print(name)
    cdsp = current_app.config['CAMILLA']
    if name == "state":
        try:
            result = cdsp.get_state()
        except IOError:
            try:
                cdsp.connect()
                result = cdsp.get_state()
            except IOError:
                result = "offline"
    elif name == "signalrange":
        result = cdsp.get_signal_range()
    elif name == "signalrangedb":
        result = cdsp.get_signal_range_dB()
    elif name == "capturerateraw":
        result = cdsp.get_capture_rate_raw()
    elif name == "capturerate":
        result = cdsp.get_capture_rate()
    elif name == "rateadjust":
        result = cdsp.get_rate_adjust()
    elif name == "updateinterval":
        result = cdsp.get_update_interval()
    elif name == "configname":
        result = cdsp.get_config_name()     
    elif name == "configraw":
        result = cdsp.get_config_raw()
    else:
        result = "ERROR"
    print(result)
    return str(result)

@view.route('/api/setparam/<name>', methods=['GET', 'POST'])
def set_param(name):
    value = request.get_data().decode()
    name = name.lower()
    print(name, value)
    cdsp = current_app.config['CAMILLA']
    if name == "updateinterval":
        cdsp.set_update_interval(value)
    elif name == "configname":
        cdsp.set_config_name(value)     
    elif name == "configraw":
        cdsp.set_config_raw(value)
    return "OK"

@view.route('/api/evalfilter', methods=['GET', 'POST'])
def eval_filter():
    content = request.get_json(silent=True)
    print("content", content)
    image=plot_filter(content["config"], name=content["name"], samplerate=content["samplerate"], npoints=1000, toimage=True)
    return send_file(image, mimetype='image/svg+xml')

@view.route('/api/evalpipeline', methods=['GET', 'POST'])
def eval_pipeline():
    content = request.get_json(silent=True)
    print("content", content)
    image=plot_pipeline(content, toimage=True)
    return send_file(image, mimetype='image/svg+xml')

@view.route('/api/getconfig', methods=['GET', 'POST'])
def get_config():
    cdsp = current_app.config['CAMILLA']
    config = cdsp.get_config()
    return config

@view.route('/api/setconfig', methods=['GET', 'POST'])
def set_config():
    content = request.get_json(silent=True)
    print("content", content)
    cdsp = current_app.config['CAMILLA']
    cdsp.set_config(content)
    return "OK"

@view.route('/api/configtoyml', methods=['GET', 'POST'])
def config_to_yml():
    content = request.get_json(silent=True)
    print("content", content)
    conf_yml = yaml.dump(content)
    return conf_yml

@view.route('/api/ymltojson', methods=['GET', 'POST'])
def yml_to_json():
    config_ymlstr = request.get_data().decode()
    cdsp = current_app.config['CAMILLA']
    config = cdsp.read_config(config_ymlstr)
    return config

@view.route('/api/validateconfig', methods=['GET', 'POST'])
def validate_config():
    config = request.get_json(silent=True)
    cdsp = current_app.config['CAMILLA']
    try:
        _val_config = cdsp.validate_config(config)
    except CamillaError as e:
        return str(e)
    return "OK"

@view.route('/api/version', methods=['GET', 'POST'])
def get_version():
    cdsp = current_app.config['CAMILLA']
    vers_tup = cdsp.get_version()
    version = {"major": vers_tup[0], "minor": vers_tup[1], "patch": vers_tup[2]}
    return version



