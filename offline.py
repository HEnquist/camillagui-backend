import subprocess

import yaml


def start_backup_cdsp(config):
    backup_cdsp_path = config["backup_camilla_path"]
    backup_cdsp_port = config["backup_camilla_port"]
    if backup_cdsp_path and backup_cdsp_port:
        subprocess.Popen([backup_cdsp_path, "-p", str(backup_cdsp_port), "-w"])


def backup_cdsp(request):
    backup = request.app["BACKUP-CAMILLA"]
    if not backup.is_connected():
        try:
            backup.connect()
        except ConnectionRefusedError as e:
            print(e)
    if backup.is_connected():
        return backup
    else:
        return None


def cdsp_or_backup_cdsp(request):
    cdsp = request.app["CAMILLA"]
    if not cdsp.is_connected():
        backup = backup_cdsp(request)
        if backup:
            return backup
    return cdsp


def set_cdsp_config_or_validate_with_backup_cdsp(json_config, request):
    cdsp = request.app["CAMILLA"]
    if cdsp.is_connected():
        cdsp.set_config(json_config)
    else:
        backup = backup_cdsp(request)
        if backup:
            backup.validate_config(json_config)


def save_to_working_config(json_config, request):
    working_config_file = request.app["working_config"]
    save_working_config = request.app["save_working_config"]
    if working_config_file and save_working_config:
        yaml_config = yaml.dump(json_config).encode('utf-8')
        with open(working_config_file, "wb") as f:
            f.write(yaml_config)