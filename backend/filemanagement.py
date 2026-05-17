import io
import logging
import ntpath
import os
import traceback
import zipfile
from copy import deepcopy
from os import rename
from os.path import (
    basename,
    commonpath,
    getmtime,
    getsize,
    isabs,
    isfile,
    join,
    normpath,
    realpath,
    relpath,
    split,
)
from typing import Optional

import yaml
from aiohttp import web
from camilladsp import CamillaError
from camilladsp_plot.audiofileread import read_wav_header
from yaml.scanner import ScannerError

from .legacy_config_import import identify_version, CURRENT_VERSION

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


def path_of_config_file(request, config_name):
    config_folder = request.app["config_dir"]
    return file_in_folder(config_folder, config_name)


def path_of_coeff_file(request, coeff_name):
    coeff_folder = request.app["coeff_dir"]
    return file_in_folder(coeff_folder, coeff_name)


def path_of_audiofile(request, wav_name):
    wav_folder = request.app["audiofiles_dir"]
    return file_in_folder(wav_folder, wav_name)


async def store_files(folder, request, allowed_extensions=None):
    """
    Write a set of files (raw data) to disk.
    If allowed_extensions is given (e.g. {".wav"}), files with other
    extensions are skipped.
    """
    data = await request.post()
    i = 0
    skipped = 0
    while True:
        filename = f"file{i}"
        if filename not in data:
            break
        file = data[filename]
        filename = file.filename
        if allowed_extensions is not None:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in allowed_extensions:
                skipped += 1
                i += 1
                continue
        content = file.file.read()
        with open(file_in_folder(folder, filename), "wb") as f:
            f.write(content)
        i += 1
    saved = i - skipped
    msg = f"Saved {saved} file(s)"
    if skipped:
        msg += f", skipped {skipped} (unsupported extension)"
    return web.Response(text=msg)


def list_of_files_in_directory(
    folder, file_stats=True, title_and_desc=False, wav_info=False, validator=None
):
    """
    Return a list of files (name and modification date) in a folder.
    """

    files_list = []
    for file in os.listdir(folder):
        file_data = _get_file_data(
            folder,
            file,
            file_stats=file_stats,
            title_and_desc=title_and_desc,
            wav_info=wav_info,
            validator=validator,
        )
        if file_data is not None:
            files_list.append(file_data)

    sorted_files = sorted(files_list, key=lambda x: x["name"].lower())
    return sorted_files


def _get_title_and_desc(filepath, file_data, folder, validator=None):
    file_data["title"] = None
    file_data["description"] = None
    file_data["version"] = None
    file_data["valid"] = False
    file_data["errors"] = None
    with open(filepath, encoding="utf-8") as f:
        try:
            parsed = yaml.safe_load(f)
            if not isinstance(parsed, dict):
                file_data["errors"] = [
                    (
                        [],
                        "This does not appear to be a CamillaDSP config file.",
                        "error",
                    )
                ]
                return
            file_data["title"] = parsed.get("title")
            file_data["description"] = parsed.get("description")
            file_data["version"] = identify_version(parsed)
            if file_data["version"] is None:
                file_data["errors"] = [
                    (
                        [],
                        "This does not appear to be a CamillaDSP config file.",
                        "error",
                    )
                ]
            elif file_data["version"] == CURRENT_VERSION and validator is not None:
                parsed_abs = make_config_filter_paths_absolute(parsed, folder)
                validator.validate_config(parsed_abs)
                issue_list = validator.get_errors()
                blocking_errors = [issue for issue in issue_list if issue[2] == "error"]
                if len(blocking_errors) > 0:
                    file_data["errors"] = issue_list
                else:
                    file_data["valid"] = True
                    if len(issue_list) > 0:
                        file_data["errors"] = issue_list
            elif file_data["version"] < CURRENT_VERSION:
                file_data["valid"] = False
                file_data["errors"] = [
                    (
                        [],
                        f"This config is made for the previous version {file_data['version']} of CamillaDSP.",
                        "error",
                    )
                ]
        except yaml.YAMLError as e:
            if hasattr(e, "problem_mark"):
                mark = e.problem_mark
                errordesc = f"This file has a YAML syntax error on line: {mark.line + 1}, column: {mark.column + 1}"
            else:
                errordesc = "This config file has a YAML syntax error."
            file_data["errors"] = [([], errordesc, "error")]
        except (AttributeError, UnicodeDecodeError):
            file_data["errors"] = [
                ([], "This does not appear to be a YAML file.", "error")
            ]
        except Exception as e:
            file_data["errors"] = [([], f"Error: {e}", "error")]


def _get_file_data(
    folder, file, file_stats=True, title_and_desc=False, wav_info=False, validator=None
):
    filepath = file_in_folder(folder, file)
    if not isfile(filepath) or file.startswith("."):
        # skip directories and hidden files
        return None

    file_data = {
        "name": file,
    }
    if file_stats:
        file_data["lastModified"] = getmtime(filepath)
        file_data["size"] = getsize(filepath)

    if title_and_desc:
        _get_title_and_desc(filepath, file_data, folder, validator=validator)

    if wav_info and file.lower().endswith(".wav"):
        _get_wav_info(filepath, file_data)

    return file_data


def _get_wav_info(filepath, file_data):
    file_data["samplerate"] = None
    file_data["channels"] = None
    file_data["sampleformat"] = None
    file_data["duration"] = None
    file_data["valid"] = False
    try:
        info = read_wav_header(filepath)
    except Exception:
        info = None
    if info is None:
        return
    file_data["samplerate"] = info.get("samplerate")
    file_data["channels"] = info.get("channels")
    file_data["sampleformat"] = info.get("sampleformat")
    byterate = info.get("byterate")
    datalength = info.get("datalength")
    if byterate and datalength is not None:
        file_data["duration"] = datalength / byterate
    file_data["valid"] = True


def list_of_filenames_in_directory(folder):
    return [
        file["name"] for file in list_of_files_in_directory(folder, file_stats=False)
    ]


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
            with open(file_path, "rb") as _file:
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
                logging.debug("Config path from statefile: %s", filename)
                return filename
            logging.error(
                "CamillaDSP runs without state file and is unable to persistently store config file path"
            )
            return None
        if statefile_path:
            logging.debug("Getting config from statefile: %s", statefile_path)
            confpath = _read_statefile_config_path(statefile_path)
            return _verify_path_in_config_dir(confpath, config_dir)
        logging.error(
            "The backend config has no state file and is unable to persistently store config file path"
        )
        return None
    try:
        logging.debug("Running command: %s", on_get)
        stream = os.popen(on_get)
        result = stream.read().strip()
        logging.debug("Command result: %s", result)
        fname = _verify_path_in_config_dir(result, config_dir)
        return fname
    except Exception:
        logging.error("Failed to run on_get_active_config command")
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
                logging.debug("Update config file path in statefile to '%s'", filepath)
                _update_statefile_config_path(statefile_path, filepath)
            except Exception:
                logging.error("Failed to update statefile at %s", statefile_path)
                traceback.print_exc()
        else:
            logging.error(
                "The backend config has no state file and is unable to persistently store config file path"
            )
    else:
        dsp_statefile_path = cdsp.general.state_file_path()
        if dsp_statefile_path:
            logging.debug("Send set config file path command with '%s'", filepath)
            cdsp.config.set_file_path(filepath)
        else:
            logging.error(
                "CamillaDSP runs without state file and is unable to persistently store config file path"
            )
    if on_set:
        try:
            cmd = on_set.format(f'"{filepath}"')
            logging.debug("Running command: %s", cmd)
            os.system(cmd)
        except Exception:
            logging.error("Failed to run on_set_active_config command")
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
        "The config file path '%s' is not in the config dir '%s'", path, config_dir
    )
    return None


def _update_statefile_config_path(statefile_path, new_config_path):
    """
    Read a statefile if possible, update the config filename, and write the result"
    """
    try:
        with open(statefile_path, encoding="utf-8") as f:
            state = yaml.safe_load(f)
    except ScannerError as e:
        logging.error(
            "Invalid yaml syntax in statefile: %s, details: %s", statefile_path, e
        )
        state = deepcopy(DEFAULT_STATEFILE)
    except OSError as e:
        logging.error(
            "Statefile could not be opened: %s, details: %s", statefile_path, e
        )
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
        with open(statefile_path, encoding="utf-8") as f:
            state = yaml.safe_load(f)
            return state["config_path"]
    except ScannerError as e:
        logging.error(
            "Invalid yaml syntax in statefile: %s, details: %s", statefile_path, e
        )
    except OSError as e:
        logging.error(
            "Statefile could not be opened: %s, details: %s", statefile_path, e
        )
    return None


def save_config_to_yaml_file(config_name, config_object, request):
    """
    Write a given config object to a yaml file.
    """
    config_file = path_of_config_file(request, config_name)
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


def make_config_filter_paths_absolute(config_object, config_dir, coeff_dir=None):
    """
    Convert paths to coefficient files in a config to absolute paths.
    Bare filenames (no separators) resolve against coeff_dir when provided;
    relative paths with separators resolve against config_dir.
    """

    return convert_config_filter_paths(
        config_object,
        lambda path: coeff_path_to_absolute(path, config_dir, coeff_dir),
    )


def make_capture_file_path_absolute(config_object, audiofiles_dir):
    """
    If the capture device is WavFile or RawFile and its filename is relative,
    resolve it against audiofiles_dir.
    """
    if not audiofiles_dir:
        return config_object
    config = deepcopy(config_object)
    capture = config.get("devices", {}).get("capture")
    if not isinstance(capture, dict) or capture.get("type") not in ("WavFile", "RawFile"):
        return config
    filename = capture.get("filename")
    if filename:
        capture["filename"] = make_absolute(filename, audiofiles_dir)
    return config


def make_playback_file_path_absolute(config_object, audiofiles_dir):
    """
    If the playback device is File and its filename is relative,
    resolve it against audiofiles_dir.
    """
    if not audiofiles_dir:
        return config_object
    config = deepcopy(config_object)
    playback = config.get("devices", {}).get("playback")
    if not isinstance(playback, dict) or playback.get("type") != "File":
        return config
    filename = playback.get("filename")
    if filename:
        playback["filename"] = make_absolute(filename, audiofiles_dir)
    return config


def make_audio_file_paths_bare(config_object, audiofiles_dir):
    """
    Strip audiofiles_dir prefix from capture (WavFile/RawFile) and playback (File)
    filenames, leaving bare filenames for GUI display.
    Paths outside audiofiles_dir are returned unchanged.
    """
    if not audiofiles_dir:
        return config_object
    config = deepcopy(config_object)
    capture = config.get("devices", {}).get("capture")
    if isinstance(capture, dict) and capture.get("type") in ("WavFile", "RawFile"):
        filename = capture.get("filename")
        if filename:
            capture["filename"] = _to_bare_filename(filename, audiofiles_dir)
    playback = config.get("devices", {}).get("playback")
    if isinstance(playback, dict) and playback.get("type") == "File":
        filename = playback.get("filename")
        if filename:
            playback["filename"] = _to_bare_filename(filename, audiofiles_dir)
    return config


def strip_config_paths_to_bare_filenames(config_object):
    """
    Reduce all coeff and audio device paths in a config to bare filenames.
    Used when importing configs from external sources where the original
    directory structure is unknown. Never raises — partial or malformed
    configs are returned as-is.
    ntpath.basename is used instead of os.path.basename because uploaded configs
    may come from Windows systems, and ntpath handles both / and \\ as separators
    on all platforms.
    """
    if not isinstance(config_object, dict):
        return config_object
    try:
        config = deepcopy(config_object)
        for filt in config.get("filters", {}).values() if isinstance(config.get("filters"), dict) else []:
            if not isinstance(filt, dict):
                continue
            params = filt.get("parameters")
            if not isinstance(params, dict):
                continue
            if filt.get("type") == "Conv" and params.get("type") in ("Raw", "Wav"):
                filename = params.get("filename")
                if filename:
                    params["filename"] = ntpath.basename(filename)
        devices = config.get("devices")
        if isinstance(devices, dict):
            capture = devices.get("capture")
            if isinstance(capture, dict) and capture.get("type") in ("WavFile", "RawFile"):
                filename = capture.get("filename")
                if filename:
                    capture["filename"] = ntpath.basename(filename)
            playback = devices.get("playback")
            if isinstance(playback, dict) and playback.get("type") == "File":
                filename = playback.get("filename")
                if filename:
                    playback["filename"] = ntpath.basename(filename)
        return config
    except Exception:
        return config_object


def _to_bare_filename(path, directory):
    """
    If path is within directory, return just the basename.
    Otherwise return path unchanged.
    """
    if not isabs(path):
        return os.path.basename(path)
    canonical = realpath(path)
    if is_path_in_folder(canonical, directory):
        return os.path.basename(canonical)
    return path


def validate_config_paths(config_object, coeff_dir, audiofiles_dir):
    """
    Check that all file paths in the config are within their configured directories.
    Returns a list of offending paths that escape the configured dirs.
    """
    offenders = []
    filters = config_object.get("filters") or {}
    for filt in filters.values():
        if filt.get("type") == "Conv" and filt.get("parameters", {}).get("type") in ("Raw", "Wav"):
            filename = filt["parameters"].get("filename")
            if filename and not _path_is_safe(filename, coeff_dir):
                offenders.append(filename)
    capture = config_object.get("devices", {}).get("capture") or {}
    if capture.get("type") in ("WavFile", "RawFile"):
        filename = capture.get("filename")
        if filename and not _path_is_safe(filename, audiofiles_dir):
            offenders.append(filename)
    playback = config_object.get("devices", {}).get("playback") or {}
    if playback.get("type") == "File":
        filename = playback.get("filename")
        if filename and not _path_is_safe(filename, audiofiles_dir):
            offenders.append(filename)
    return offenders


def _path_is_safe(path, configured_dir):
    """
    A path is safe if it contains no directory separators (bare filename),
    or if it is an absolute path resolving within configured_dir.
    """
    if not isabs(path):
        return ntpath.basename(path) == path
    if not configured_dir:
        return False
    return is_path_in_folder(realpath(path), configured_dir)


def make_config_filter_paths_relative(config_object, config_dir, coeff_dir=None):
    """
    Convert absolute coefficient paths in a config to GUI-friendly form.
    Paths inside coeff_dir become bare filenames; others become relative to config_dir.
    """
    return convert_config_filter_paths(
        config_object,
        lambda path: _coeff_path_to_relative(path, config_dir, coeff_dir),
    )


def _coeff_path_to_relative(path, config_dir, coeff_dir):
    if not isabs(path):
        return path
    if coeff_dir and is_path_in_folder(path, coeff_dir):
        return basename(path)
    return make_relative(path, config_dir)


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



def coeff_path_to_absolute(path, config_dir, coeff_dir=None):
    """
    Resolve a single coeff path to absolute.
    Bare filenames resolve against coeff_dir; relative paths against config_dir.
    """
    if isabs(path):
        return path
    if coeff_dir and ntpath.basename(path) == path:
        return normpath(join(coeff_dir, path))
    return normpath(join(config_dir, path))


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


def rename_config_or_return_error(request, source, target) -> Optional[str]:
    source_file = path_of_config_file(request, source)
    target_file = path_of_config_file(request, target)
    if os.path.isfile(target_file):
        return "File " + target + " already exists"
    rename(source_file, target_file)
    return None


def rename_coeff_or_return_error(request, source, target) -> Optional[str]:
    source_file = path_of_coeff_file(request, source)
    target_file = path_of_coeff_file(request, target)
    if os.path.isfile(target_file):
        return "File " + target + " already exists"
    rename(source_file, target_file)
    return None


def rename_audiofile_or_return_error(request, source, target) -> Optional[str]:
    source_file = path_of_audiofile(request, source)
    target_file = path_of_audiofile(request, target)
    if os.path.isfile(target_file):
        return "File " + target + " already exists"
    rename(source_file, target_file)
    return None
