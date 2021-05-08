import os
import pathlib

import yaml

BASEPATH = pathlib.Path(__file__).parent.parent.absolute()
config_path = BASEPATH / 'config' / 'camillagui.yml'
gui_config_path = BASEPATH / 'config' / 'gui-config.yml'


def get_config(path):
    with open(path) as f:
        config = yaml.safe_load(f)
    config["config_dir"] = os.path.abspath(os.path.expanduser(config["config_dir"]))
    config["coeff_dir"] = os.path.abspath(os.path.expanduser(config["coeff_dir"]))
    config["default_config"] = absolute_path_or_none_if_empty(config["default_config"])
    config["active_config"] = absolute_path_or_none_if_empty(config["active_config"])
    if "update_symlink" not in config:
        config["update_symlink"] = True
    if "on_set_active_config" not in config:
        config["on_set_active_config"] = None
    if "on_get_active_config" not in config:
        config["on_get_active_config"] = None
    print(config)
    return config


def absolute_path_or_none_if_empty(path):
    if path:
        return os.path.abspath(os.path.expanduser(path))
    else:
        return None


config = get_config(config_path)
