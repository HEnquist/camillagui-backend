import os
import pathlib
import sys

import yaml
from yaml.scanner import ScannerError

BASEPATH = pathlib.Path(__file__).parent.parent.absolute()
CONFIG_PATH = BASEPATH / 'config' / 'camillagui.yml'
GUI_CONFIG_PATH = BASEPATH / 'config' / 'gui-config.yml'

GUI_CONFIG_DEFAULTS = {
    "hide_capture_samplerate": False,
    "hide_silence": False,
    "hide_capture_device": False,
    "hide_playback_device": False,
    "applyConfigAutomatically": False,
}

def _load_yaml(path):
    try:
        with open(path) as f:
            config = yaml.safe_load(f)
            return config
    except ScannerError as e:
        print(f"ERROR! Invalid yaml syntax in config file: {path}")
        print(f"Details: {e}")
    except OSError as e:
        print(f"ERROR! Config file could not be opened: {path}")
        print(f"Details: {e}")
    return None
    

def get_config(path):
    config = _load_yaml(path)
    if config is None:
        sys.exit()
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
    if "supported_capture_types" not in config:
        config["supported_capture_types"] = None
    if "supported_playback_types" not in config:
        config["supported_playback_types"] = None
    print("Backend configuration:")
    print(yaml.dump(config))
    return config


def absolute_path_or_none_if_empty(path):
    if path:
        return os.path.abspath(os.path.expanduser(path))
    else:
        return None


def get_gui_config_or_defaults():
    config = _load_yaml(GUI_CONFIG_PATH)
    if config is not None:
        return config
    else:    
        print("Unable to read gui config file, using defaults")
        return GUI_CONFIG_DEFAULTS



config = get_config(CONFIG_PATH)