import io
import os
import zipfile
from copy import deepcopy
from os.path import (
    isfile,
    split,
    join,
    realpath,
    relpath,
    normpath,
    isabs,
    commonpath,
    getmtime,
    getsize,
)
import logging
import traceback

import yaml
from yaml.scanner import ScannerError
from aiohttp import web

from camilladsp import CamillaError

DEFAULT_STATEFILE = {
    "config_path": None,
    "mute": [False, False, False, False, False],
    "volume": [0.0, 0.0, 0.0, 0.0, 0.0],
}


def file_in_folder(folder, filename):
    """
    Safely join a folder and filename.
    """
    if "/" in filename or "\\" in filename:
        raise IOError("Filename may not contain any slashes/backslashes")
    return os.path.abspath(os.path.join(folder, filename))


def path_of_configfile(request, config_name):
    config_folder = request.app["config_dir"]
    return file_in_folder(config_folder, config_name)


async def store_files(folder, request):
    """
    Write a set of files (raw data) to disk.
    """
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


def list_of_files_in_directory(folder, file_stats=True, title_and_desc=False):
    """
    Return a list of files (name and modification date) in a folder.
    """

    files_list = []
    for file in os.listdir(folder):
        filepath = file_in_folder(folder, file)
        if not isfile(filepath) or file.startswith("."):
            # skip directories and hidden files
            continue

        file_data = {
            "name": file,
        }
        if file_stats:
            file_data["lastModified"] = getmtime(filepath)
            file_data["size"] = getsize(filepath)

        if title_and_desc:
            with open(filepath) as f:
                try:
                    parsed = yaml.safe_load(f)
                    title = parsed.get("title")
                    desc = parsed.get("description")
                except yaml.YAMLError as e:
                    title = "(YAML syntax error)"
                    desc = "This config file has a YAML syntax error."
                    if hasattr(e, 'problem_mark'):
                        mark = e.problem_mark
                        desc = f"This file has a YAML syntax error on line: {mark.line + 1}, column: {mark.column + 1}."
                except (AttributeError, UnicodeDecodeError):
                    title = "(not a YAML file)"
                    desc = "This does not appear to be a YAML file."
                except Exception as e:
                    title = "(error reading file)"
                    desc = f"Error: {e}"
            file_data["title"] = title
            file_data["description"] = desc
        files_list.append(file_data)

    sorted_files = sorted(files_list, key=lambda x: x["name"].lower())
    return sorted_files


def list_of_filenames_in_directory(folder):
    return [file["name"] for file in list_of_files_in_directory(folder, file_stats=False)]


def delete_files(folder, files):
    """
    Delete a list of files from a folder.
    """
    for file in files:
        path = file_in_folder(folder, file)
        os.remove(path)


async def zip_response(request, zip_file, file_name):
    """
    Send a response with a binary file (zip).
    """
    response = web.StreamResponse()
    response.headers.add("Content-Disposition", "attachment; filename=" + file_name)
    await response.prepare(request)
    await response.write(zip_file)
    await response.write_eof()
    return response


def zip_of_files(folder, files):
    """
    Compress a list of files to a zip.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for file_name in files:
            file_path = file_in_folder(folder, file_name)
            with open(file_path, "r") as file:
                zip_file.write(file_path, file_name)
    return zip_buffer.getvalue()


def read_yaml_from_path_to_object(request, path):
    """
    Read a yaml file at the given path, return the validated content as a Python object.
    """
    validator = request.app["VALIDATOR"]
    validator.validate_file(path)
    return validator.get_config()


def get_active_config_path(request):
    """
    Get the active config filename.
    """
    statefile_path = request.app["statefile_path"]
    config_dir = request.app["config_dir"]
    cdsp = request.app["CAMILLA"]
    try:
        _state = cdsp.general.state()
        online = True
    except (CamillaError, IOError):
        online = False
    on_get = request.app["on_get_active_config"]
    if not on_get:
        if online:
            dsp_statefile_path = cdsp.general.state_file_path()
            if dsp_statefile_path:
                fpath = cdsp.config.file_path()
                filename = _verify_path_in_config_dir(fpath, config_dir)
                logging.debug(filename)
                return filename
            else:
                logging.error(
                    "CamillaDSP runs without state file and is unable to persistently store config file path"
                )
                return None
        elif statefile_path:
            confpath = _read_statefile_config_path(statefile_path)
            return _verify_path_in_config_dir(confpath, config_dir)
        else:
            logging.error(
                "The backend config has no state file and is unable to persistently store config file path"
            )
    else:
        try:
            logging.debug(f"Running command: {on_get}")
            stream = os.popen(on_get)
            result = stream.read().strip()
            logging.debug(f"Command result: {result}")
            fname = _verify_path_in_config_dir(result, config_dir)
            return fname
        except Exception as e:
            logging.error(f"Failed to run on_get_active_config command")
            traceback.print_exc()
            return None


def set_path_as_active_config(request, filepath):
    """
    Persistlently set the given config file path as the active config.
    """
    on_set = request.app["on_set_active_config"]
    statefile_path = request.app["statefile_path"]
    cdsp = request.app["CAMILLA"]
    try:
        _state = cdsp.general.state()
        online = True
    except (CamillaError, IOError):
        online = False
    if not online:
        if statefile_path:
            try:
                logging.debug(f"Update config file path in statefile to '{filepath}'")
                _update_statefile_config_path(statefile_path, filepath)
            except Exception as e:
                logging.error(f"Failed to update statefile at {statefile_path}")
                traceback.print_exc()
        else:
            logging.error(
                "The backend config has no state file and is unable to persistently store config file path"
            )
    else:
        dsp_statefile_path = cdsp.general.state_file_path()
        if dsp_statefile_path:
            logging.debug(f"Send set config file path command with '{filepath}'")
            cdsp.config.set_file_path(filepath)
        else:
            logging.error(
                "CamillaDSP runs without state file and is unable to persistently store config file path"
            )
    if on_set:
        try:
            cmd = on_set.format(f'"{filepath}"')
            logging.debug(f"Running command: {cmd}")
            os.system(cmd)
        except Exception as e:
            logging.error(f"Failed to run on_set_active_config command")
            traceback.print_exc()


def _verify_path_in_config_dir(path, config_dir):
    """
    Verify that a given path points to a file in config_dir.
    Returns the filename without the rest of the path.
    """
    if path is None:
        logging.warning("The config file path is None")
        return None
    canonical = realpath(path)
    if is_path_in_folder(canonical, config_dir):
        _head, tail = split(canonical)
        return tail
    logging.error(
        f"The config file path '{path}' is not in the config dir '{config_dir}'"
    )
    return None


def _update_statefile_config_path(statefile_path, new_config_path):
    """
    Read a statefile if possible, update the config filename, and write the result"
    """
    try:
        with open(statefile_path) as f:
            state = yaml.safe_load(f)
    except ScannerError as e:
        logging.error(f"Invalid yaml syntax in statefile: {statefile_path}")
        logging.error(f"Details: {e}")
        state = deepcopy(DEFAULT_STATEFILE)
    except OSError as e:
        logging.error(f"Statefile could not be opened: {statefile_path}")
        logging.error(f"Details: {e}")
        state = deepcopy(DEFAULT_STATEFILE)
    state["config_path"] = new_config_path
    yaml_state = yaml.dump(state).encode("utf-8")
    with open(statefile_path, "wb") as f:
        f.write(yaml_state)


def _read_statefile_config_path(statefile_path):
    """
    Read a statefile if possible, and get the config_path"
    """
    try:
        with open(statefile_path) as f:
            state = yaml.safe_load(f)
            return state["config_path"]
    except ScannerError as e:
        logging.error(f"Invalid yaml syntax in statefile: {statefile_path}")
        logging.error(f"Details: {e}")
    except OSError as e:
        logging.error(f"Statefile could not be opened: {statefile_path}")
        logging.error(f"Details: {e}")
    return None


def save_config_to_yaml_file(config_name, config_object, request):
    """
    Write a given config object to a yaml file.
    """
    config_file = path_of_configfile(request, config_name)
    yaml_config = yaml.dump(config_object).encode("utf-8")
    with open(config_file, "wb") as f:
        f.write(yaml_config)


def coeff_dir_relative_to_config_dir(request):
    """
    Get the relative path of the coeff_dir with respect to config_dir.
    """
    relative_coeff_dir = relpath(
        request.app["coeff_dir"], start=request.app["config_dir"]
    )
    coeff_dir_with_folder_separator_at_end = join(relative_coeff_dir, "")
    return coeff_dir_with_folder_separator_at_end


def make_config_filter_paths_absolute(config_object, config_dir):
    """
    Convert paths to coefficient files in a config from relative to absolute.
    """
    conversion = lambda path, config_dir=config_dir: make_absolute(path, config_dir)
    return convert_config_filter_paths(config_object, conversion)


def make_config_filter_paths_relative(config_object, config_dir):
    """
    Convert paths to coefficient files in a config from absolute to relative.
    """
    conversion = lambda path, config_dir=config_dir: make_relative(path, config_dir)
    return convert_config_filter_paths(config_object, conversion)


def convert_config_filter_paths(config_object, conversion):
    """
    Apply a path conversion to all filter coefficient paths of a config.
    """
    config = deepcopy(config_object)
    filters = config.get("filters")
    if filters is not None:
        for filter_name in filters:
            filt = filters[filter_name]
            convert_filter_path(filt, conversion)
    return config


def convert_filter_path(filter_as_dict, conversion):
    """
    Apply a path conversion to a filter coefficient path.
    """
    ftype = filter_as_dict["type"]
    parameters = filter_as_dict["parameters"]
    if ftype == "Conv" and parameters["type"] in ["Raw", "Wav"]:
        filename = parameters["filename"]
        if filename:
            filename = conversion(filename)
        parameters["filename"] = filename


def replace_relative_filter_path_with_absolute_paths(filter_as_dict, config_dir):
    """
    Convert paths to coefficient files in a config from absolute to relative.
    """
    conversion = lambda path, config_dir=config_dir: make_absolute(path, config_dir)
    convert_filter_path(filter_as_dict, conversion)


def make_absolute(path, base_dir):
    """
    Make a relative path absolute.
    """
    return path if isabs(path) else normpath(join(base_dir, path))


def replace_tokens_in_filter_config(filterconfig, samplerate, channels):
    """
    Replace tokens in coefficient file paths.
    """
    ftype = filterconfig["type"]
    parameters = filterconfig["parameters"]
    if ftype == "Conv" and parameters["type"] in ["Raw", "Wav"]:
        parameters["filename"] = (
            parameters["filename"]
            .replace("$samplerate$", str(samplerate))
            .replace("$channels$", str(channels))
        )


def make_relative(path, base_dir):
    """
    Make a path relative to a base directory.
    """
    return relpath(path, start=base_dir) if isabs(path) else path


def is_path_in_folder(path, folder):
    """
    Check if a file is in a given directory.
    """
    return folder == commonpath([path, folder])
