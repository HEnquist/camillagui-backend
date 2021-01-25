import pathlib
import yaml
import os
import subprocess


BASEPATH = pathlib.Path(__file__).parent.absolute()
config_path = BASEPATH/ 'config' / 'camillagui.yml'
gui_config_path = BASEPATH/ 'config' / 'gui-config.yml'


def get_config(path):
    with open(path) as f:
        config = yaml.safe_load(f)
    config["config_dir"] = os.path.abspath(os.path.expanduser(config["config_dir"]))
    config["coeff_dir"] = os.path.abspath(os.path.expanduser(config["coeff_dir"]))
    config["working_config"] = absolute_path_or_none_if_empty(config["working_config"])
    config["backup_camilla_path"] = absolute_path_or_none_if_empty(config["backup_camilla_path"])
    print(config)
    return config


def absolute_path_or_none_if_empty(path):
    if path:
        return os.path.abspath(os.path.expanduser(path))
    else:
        return None


def start_backup_cdsp(config):
    backup_cdsp_path = config["backup_camilla_path"]
    backup_cdsp_port = config["backup_camilla_port"]
    if backup_cdsp_path and backup_cdsp_port:
        subprocess.Popen([backup_cdsp_path, "-p", str(backup_cdsp_port), "-w"])


config = get_config(config_path)
start_backup_cdsp(config)
