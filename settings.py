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
    working_config = config["working_config"]
    if working_config:
        config["working_config"] = os.path.abspath(os.path.expanduser(working_config))
    else:
        config["working_config"] = None
    print(config)
    return config

config = get_config(config_path)