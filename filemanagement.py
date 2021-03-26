import io
import os
import zipfile
from os.path import isfile, islink, split

import yaml
from aiohttp import web

from offline import cdsp_or_backup_cdsp


def file_in_folder(folder, filename):
    if '/' in filename or '\\' in filename:
        raise IOError("Filename may not contain any slashes/backslashes")
    return os.path.abspath(os.path.join(folder, filename))


def path_of_configfile(request, config_name):
    config_folder = request.app["config_dir"]
    return file_in_folder(config_folder, config_name)


async def store_files(folder, request):
    data = await request.post()
    i = 0
    while True:
        filename = "file{}".format(i)
        if filename not in data:
            break
        file = data[filename]
        filename = file.filename
        content = file.file.read()
        with open(file_in_folder(folder, filename), "wb") as f:
            f.write(content)
        i += 1
    return web.Response(text="Saved {} file(s)".format(i))


def list_of_files_in_directory(folder):
    files = [file_in_folder(folder, file)
             for file in os.listdir(folder)
             if os.path.isfile(file_in_folder(folder, file))]
    files_list = []
    for f in files:
        fname = os.path.basename(f)
        files_list.append(fname)
    return sorted(files_list, key=lambda x: x.lower())


def delete_files(folder, files):
    for file in files:
        path = file_in_folder(folder, file)
        os.remove(path)


async def zip_response(request, zip_file, file_name):
    response = web.StreamResponse()
    response.headers.add("Content-Disposition", "attachment; filename=" + file_name)
    await response.prepare(request)
    await response.write(zip_file)
    await response.write_eof()
    return response


def zip_of_files(folder, files):
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for file_name in files:
            file_path = file_in_folder(folder, file_name)
            with open(file_path, 'r') as file:
                zip_file.writestr(file_name, file.read())
    return zip_buffer.getvalue()


def get_yaml_as_json(request, path):
    with open(path, 'r') as file:
        cdsp = cdsp_or_backup_cdsp(request)
        yaml_config = file.read()
        return cdsp.read_config(yaml_config)


def get_active_config(active_config):
    if islink(active_config) and isfile(active_config):
        target = os.readlink(active_config)
        head, tail = split(target)
        return tail
    else:
        return None


def set_as_active_config(active_config, file):
    if not active_config:
        return
    if islink(active_config):
        os.unlink(active_config)
    os.symlink(file, active_config)


def save_to_active_config(json_config, request):
    active_config_file = request.app["active_config"]
    if active_config_file and islink(active_config_file):
        yaml_config = yaml.dump(json_config).encode('utf-8')
        with open(active_config_file, "wb") as f:
            f.write(yaml_config)
