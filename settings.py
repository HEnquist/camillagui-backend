import pathlib
import yaml
import os

BASEPATH = pathlib.Path(__file__).parent.absolute()
config_path = BASEPATH/ 'config' / 'camillagui.yml'

def get_config(path):
    with open(path) as f:
        config = yaml.safe_load(f)
    config["config_dir"] = os.path.abspath(os.path.expanduser(config["config_dir"]))
    config["coeff_dir"] = os.path.abspath(os.path.expanduser(config["coeff_dir"]))
    current_config = config["current_config"]
    if current_config:
        config["current_config"] = os.path.abspath(os.path.expanduser(current_config))
    else:
        config["current_config"] = None
    print(config)
    return config

config = get_config(config_path)