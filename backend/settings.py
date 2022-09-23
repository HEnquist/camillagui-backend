import os
import pathlib
import sys

import yaml
from yaml.scanner import ScannerError

BASEPATH = pathlib.Path(__file__).parent.parent.absolute()
CONFIG_PATH = BASEPATH / 'config' / 'camillagui.yml'
GUI_CONFIG_PATH = BASEPATH / 'config' / 'gui-config.yml'

# Default values for the optional gui config.
GUI_CONFIG_DEFAULTS = {
    "hide_capture_samplerate": False,
    "hide_silence": False,
    "hide_capture_device": False,
    "hide_playback_device": False,
    "apply_config_automatically": False,
    "status_update_interval": 100,
}

# Default values for the optional settings.
BACKEND_CONFIG_DEFAULTS = {
    "update_config_symlink": False,
    "update_config_txt": False,
    "on_set_active_config": None,
    "on_get_active_config": None,
    "supported_capture_types": None,
    "supported_playback_types": None,
    "log_file": None,
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
    config["config_dir"] = os.path.abspath(
        os.path.expanduser(config["config_dir"]))
    config["coeff_dir"] = os.path.abspath(
        os.path.expanduser(config["coeff_dir"]))
    config["default_config"] = absolute_path_or_none_if_empty(
        config["default_config"])
    config["active_config"] = absolute_path_or_none_if_empty(
        config["active_config"])
    config["active_config_txt"] = absolute_path_or_none_if_empty(
        config["active_config_txt"])
    for key, value in BACKEND_CONFIG_DEFAULTS.items():
        if key not in config:
            config[key] = value
    print("Backend configuration:")
    print(yaml.dump(config))
    config["can_update_active_config"] = can_update_active_config(config)
    return config


def can_update_active_config(config):
    symlink_supported = False
    txt_supported = False
    external_supported = False
    if config["update_config_symlink"]:
        conffile = config["active_config"]
        is_file = os.path.isfile(conffile)
        if is_file:
            is_link = os.path.islink(conffile)
        else:
            # The file or link doesnt exist, we can create it as a link
            is_link = True
        if not is_link:
            print(f"The file {conffile} already exists and is not a symlink.")
        is_writable = is_file_writable(conffile)
        if not is_writable:
            print(f"The file {conffile} is not writable.")
        if is_writable and is_link:
            symlink_supported = True
    if config["update_config_txt"]:
        conffile = config["active_config_txt"]
        is_writable = is_file_writable(conffile)
        if is_writable:
            txt_supported = True
        else:
            print(f"The file {conffile} is not writable.")
    if config["on_set_active_config"] and config["on_get_active_config"]:
        print("Both 'on_set_active_config' and 'on_get_active_config' options are set")
        external_supported = True
    return symlink_supported or txt_supported or external_supported


def is_file_writable(path):
    exists = os.path.isfile(path)
    if exists:
        return _is_writable(path)
    else:
        parent = os.path.dirname(path)
        return _is_writable(parent)


def _is_writable(path):
    if os.access in os.supports_follow_symlinks:
        return os.access(path, os.W_OK, follow_symlinks=False)
    else:
        return os.access(path, os.W_OK)


def absolute_path_or_none_if_empty(path):
    if path:
        return os.path.abspath(os.path.expanduser(path))
    else:
        return None


def get_gui_config_or_defaults():
    config = _load_yaml(GUI_CONFIG_PATH)
    if config is not None:
        for key, value in GUI_CONFIG_DEFAULTS.items():
            if key not in config:
                config[key] = value
        return config
    else:
        print("Unable to read gui config file, using defaults")
        return GUI_CONFIG_DEFAULTS


config = get_config(CONFIG_PATH)
