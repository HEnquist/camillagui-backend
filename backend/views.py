from os.path import isfile, expanduser, join
import yaml
import threading
import time
from aiohttp import web
from camilladsp import CamillaError
from camilladsp_plot import eval_filter, eval_filterstep
import logging
import traceback

from .filemanagement import (
    path_of_configfile, store_files, list_of_files_in_directory, delete_files,
    zip_response, zip_of_files, get_yaml_as_json, set_as_active_config, get_active_config, save_config,
    make_config_filter_paths_absolute, coeff_dir_relative_to_config_dir,
    replace_relative_filter_path_with_absolute_paths, make_config_filter_paths_relative,
    make_absolute, replace_tokens_in_filter_config
)
from .filters import defaults_for_filter, filter_options, pipeline_step_options
from .settings import get_gui_config_or_defaults

OFFLINE_CACHE = {
    "cdsp_status": "Offline",
    "cdsp_version": "(offline)",
    "capturesignalrms": [],
    "capturesignalpeak": [],
    "playbacksignalrms": [],
    "playbacksignalpeak": [],
    "capturerate": None,
    "rateadjust": None,
    "bufferlevel": None,
    "clippedsamples": None,
    "processingload": None
}

async def get_gui_index(request):
    """
    Serve the static gui files.
    """
    raise web.HTTPFound("/gui/index.html")

def _reconnect(cdsp, cache):
    done = False
    while not done:
        try:
            cdsp.connect()
            cache["cdsp_version"] = version_string(cdsp.versions.camilladsp())
            done = True
        except IOError:
            time.sleep(1)

async def get_status(request):
    """
    Get the state and singnal levels etc.
    If this fails it spawns a thread that tries to reconnect
    to the camilladsp process.
    """
    cdsp = request.app["CAMILLA"]
    reconnect_thread = request.app["RECONNECT_THREAD"]
    cache = request.app["STATUSCACHE"]
    cachetime = request.app["CACHETIME"]
    try:
        levels_since = float(request.query.get("since"))
    except:
        levels_since = None
    try:
        state = cdsp.general.state()
        state_str = state.name
        cache["cdsp_status"] = state_str
        try:
            if levels_since is not None:
                levels = cdsp.levels.levels_since(levels_since)
            else:
                levels = cdsp.levels.levels()
            cache.update({
                "capturesignalrms": levels["capture_rms"],
                "capturesignalpeak": levels["capture_peak"],
                "playbacksignalrms": levels["playback_rms"],
                "playbacksignalpeak": levels["playback_peak"],
            })
            now = time.time()
            # These values don't change that fast, let's update them only once per second.
            if now - cachetime > 1.0:
                request.app["CACHETIME"] = now
                cache.update({
                    "capturerate": cdsp.rate.capture(),
                    "rateadjust": cdsp.status.rate_adjust(),
                    "bufferlevel": cdsp.status.buffer_level(),
                    "clippedsamples": cdsp.status.clipped_samples(),
                    "processingload": cdsp.status.processing_load()
                })
        except IOError as e:
            print("TODO safe to remove this try-except? error:", e)
            pass
    except IOError:
        if reconnect_thread is None or not reconnect_thread.is_alive():
            cache.update(OFFLINE_CACHE)
            reconnect_thread = threading.Thread(target=_reconnect, args=(cdsp, cache), daemon=True)
            reconnect_thread.start()
            request.app["RECONNECT_THREAD"] = reconnect_thread
    return web.json_response(cache)


def version_string(version_array):
    """
    Build a version string from a list of parts.
    """
    return f"{version_array[0]}.{version_array[1]}.{version_array[2]}"


async def get_param(request):
    """
    Combined getter for several parameters.
    """
    name = request.match_info["name"]
    cdsp = request.app["CAMILLA"]
    if name == "volume":
        result = cdsp.volume.main()
    elif name == "mute":
        result = cdsp.mute.main()
    elif name == "signalrange":
        result = cdsp.levels.range()
    elif name == "signalrangedb":
        result = cdsp.levels.range_db()
    elif name == "capturerateraw":
        result = cdsp.rate.rate_raw()
    elif name == "updateinterval":
        result = cdsp.settings.update_interval()
    elif name == "configname":
        result = cdsp.config.file_path()
    elif name == "configraw":
        result = cdsp.config.active_raw()
    elif name == "processingload":
        result = cdsp.status.processing_load()
    else:
        raise web.HTTPNotFound(text=f"Unknown parameter {name}")
    return web.Response(text=str(result))


async def get_list_param(request):
    """
    Combined getter for several parameters where the values are lists.
    """
    name = request.match_info["name"]
    cdsp = request.app["CAMILLA"]
    if name == "capturesignalpeak":
        result = cdsp.levels.capture_peak()
    elif name == "playbacksignalpeak":
        result = cdsp.levels.playback_peak()
    else:
        result = "[]"
    return web.json_response(result)


async def set_param(request):
    """
    Combined setter for various parameters
    """
    value = await request.text()
    name = request.match_info["name"]
    cdsp = request.app["CAMILLA"]
    if name == "volume":
        cdsp.volume.set_main(value)
    elif name == "mute":
        if value.lower() == "true":
            cdsp.mute.set_main(True)
        elif value.lower() == "false":
            cdsp.mute.set_main(False)
        else:
            raise web.HTTPBadRequest(text=f"Invalid boolean value {value}")
    elif name == "updateinterval":
        cdsp.settings.set_update_interval(value)
    elif name == "configname":
        cdsp.config.set_file_path(value)
    elif name == "configraw":
        cdsp.config.set_active_raw(value)
    return web.Response(text="OK")


async def eval_filter_values(request):
    """
    Evaluate a filter. Returns values for plotting.
    """
    content = await request.json()
    config_dir = request.app["config_dir"]
    config = content["config"]
    replace_relative_filter_path_with_absolute_paths(config, config_dir)
    channels = content["channels"]
    samplerate = content["samplerate"]
    filter_file_names, _ = list_of_files_in_directory(request.app["coeff_dir"])
    if "filename" in config["parameters"]:
        filename = config["parameters"]["filename"]
        options = filter_options(filter_file_names, filename)
    else:
        options = []
    replace_tokens_in_filter_config(config, samplerate, channels)
    try:
        data = eval_filter(
            config,
            name=(content["name"]),
            samplerate=samplerate,
            npoints=1000,
        )
        data["channels"] = channels
        data["options"] = options
        return web.json_response(data)
    except FileNotFoundError:
        raise web.HTTPNotFound("Filter coefficient file not found")
    except Exception as e:
        raise web.HTTPBadRequest(str(e))

async def eval_filterstep_values(request):
    """
    Evaluate a filter step consisting of one or several filters. Returns values for plotting.
    """
    content = await request.json()
    config = content["config"]
    step_index = content["index"]
    config_dir = request.app["config_dir"]
    samplerate = content["samplerate"]
    channels = content["channels"]
    config["devices"]["samplerate"] = samplerate
    config["devices"]["capture"]["channels"] = channels
    plot_config = make_config_filter_paths_absolute(config, config_dir)
    filter_file_names, _ = list_of_files_in_directory(request.app["coeff_dir"])
    options = pipeline_step_options(filter_file_names, config, step_index)
    for _, filt in plot_config.get("filters", {}).items():
        replace_tokens_in_filter_config(filt, samplerate, channels)
    try:
        data = eval_filterstep(
            plot_config,
            step_index,
            name="Filterstep {}".format(step_index),
            npoints=1000,
        )
        data["channels"] = channels
        data["options"] = options
        return web.json_response(data)
    except FileNotFoundError:
        raise web.HTTPNotFound("Filter coefficient file not found")
    except Exception as e:
        raise web.HTTPBadRequest(str(e))

async def get_config(request):
    """
    Get running config.
    """
    cdsp = request.app["CAMILLA"]
    config = cdsp.config.active()
    return web.json_response(config)


async def set_config(request):
    """
    Apply a new config to CamillaDSP.
    """
    json = await request.json()
    json_config = json["config"]
    config_dir = request.app["config_dir"]
    cdsp = request.app["CAMILLA"]
    validator = request.app["VALIDATOR"]
    json_config_with_absolute_filter_paths = make_config_filter_paths_absolute(json_config, config_dir)
    if cdsp.is_connected():
        try:
            cdsp.config.set_active(json_config_with_absolute_filter_paths)
        except CamillaError as e:
            raise web.HTTPInternalServerError(text=str(e))
    else: 
        validator.validate_config(json_config_with_absolute_filter_paths)
        errors = validator.get_errors()
        if len(errors) > 0:
            return web.json_response(data=errors)
    return web.Response(text="OK")


async def get_default_config_file(request):
    """
    Fetch the default config from file.
    """
    default_config = request.app["default_config"]
    config_dir = request.app["config_dir"]
    if default_config and isfile(default_config):
        config = default_config
    else:
        raise web.HTTPNotFound(text="No default config")
    try:
        json_config = make_config_filter_paths_relative(get_yaml_as_json(request, config), config_dir)
    except CamillaError as e:
        logging.error(f"Failed to get default config file, error: {e}")
        raise web.HTTPInternalServerError(text=str(e))
    except Exception as e:
        logging.error("Failed to get default config file")
        traceback.print_exc()
        raise web.HTTPInternalServerError(text=str(e))
    return web.json_response(json_config)

async def get_active_config_file(request):
    """
    Get the active config. If no config is active, return the default config.
    """
    active_config_path = get_active_config(request)
    logging.debug(active_config_path)
    default_config_path = request.app["default_config"]
    config_dir = request.app["config_dir"]
    if active_config_path and isfile(join(config_dir, active_config_path)):
        config = join(config_dir, active_config_path)
    elif default_config_path and isfile(default_config_path):
        config = default_config_path
    else:
        raise web.HTTPNotFound(text="No active or default config")
    try:
        json_config = make_config_filter_paths_relative(get_yaml_as_json(request, config), config_dir)
    except CamillaError as e:
        logging.error(f"Failed to get active config from CamillaDSP, error: {e}")
        raise web.HTTPInternalServerError(text=str(e))
    except Exception as e:
        logging.error(f"Failed to get active config")
        traceback.print_exc()
        raise web.HTTPInternalServerError(text=str(e))
    if active_config_path:
        json = {"configFileName": active_config_path, "config": json_config}
    else:
        json = {"config": json_config}
    return web.json_response(json)


async def set_active_config_name(request):
    """
    Persístently set the given config file name as the active config.
    """
    json = await request.json()
    config_name = json["name"]
    config_file = path_of_configfile(request, config_name)
    set_as_active_config(request, config_file)
    return web.Response(text="OK")


async def get_config_file(request):
    """
    Read and return a config file. Takes a filname and tries to load the file from config_dir.
    """
    config_dir = request.app["config_dir"]
    config_name = request.query["name"]
    config_file = path_of_configfile(request, config_name)
    try:
        json_config = make_config_filter_paths_relative(get_yaml_as_json(request, config_file), config_dir)
    except CamillaError as e:
        raise web.HTTPInternalServerError(text=str(e))
    return web.json_response(json_config)


async def save_config_file(request):
    """
    Save a config to a given filename.
    """
    json = await request.json()
    save_config(json["filename"], json["config"], request)
    return web.Response(text="OK")


async def config_to_yml(request):
    """
    Convert a json config to yml string (for saving to disk etc).
    """
    content = await request.json()
    conf_yml = yaml.dump(content)
    return web.Response(text=conf_yml)


async def yml_config_to_json_config(request):
    """
    Parse a yml string and return as json.
    """
    config_ymlstr = await request.text()
    validator = request.app["VALIDATOR"]
    validator.validate_yamlstring(config_ymlstr)
    config = validator.get_config()
    return web.json_response(config)


async def yml_to_json(request):
    """
    Parse a yml string and return as json.
    """
    yml = await request.text()
    loaded = yaml.safe_load(yml)
    return web.json_response(loaded)


async def validate_config(request):
    """
    Validate a config, returned completed config.
    """
    config_dir = request.app["config_dir"]
    config = await request.json()
    config_with_absolute_filter_paths = make_config_filter_paths_absolute(config, config_dir)
    validator = request.app["VALIDATOR"]
    validator.validate_config(config_with_absolute_filter_paths)
    #print(yaml.dump(config_with_absolute_filter_paths, indent=2))
    errors = validator.get_errors()
    if len(errors) > 0:
        logging.debug(errors)
        return web.json_response(status=406, data=errors)
    return web.Response(text="OK")


async def store_coeffs(request):
    """
    Store a FIR coefficients file to coeff_dir.
    """
    folder = request.app["coeff_dir"]
    return await store_files(folder, request)


async def store_configs(request):
    """
    Store a config file to config_dir.
    """
    folder = request.app["config_dir"]
    return await store_files(folder, request)


async def get_stored_coeffs(request):
    """
    Fetch a list of coefficient files in coeff_dir.
    """
    coeff_dir = request.app["coeff_dir"]
    coeffs = list_of_files_in_directory(coeff_dir)
    return web.json_response(coeffs)


async def get_stored_configs(request):
    """
    Fetch a list of config files in config_dir.
    """
    config_dir = request.app["config_dir"]
    configs = list_of_files_in_directory(config_dir)
    return web.json_response(configs)


async def delete_coeffs(request):
    """
    Delete one or several coefficient files from coeff_dir.
    """
    coeff_dir = request.app["coeff_dir"]
    files = await request.json()
    delete_files(coeff_dir, files)
    return web.Response(text="ok")


async def delete_configs(request):
    """
    Delete one or several config files from config_dir.
    """
    config_dir = request.app["config_dir"]
    files = await request.json()
    delete_files(config_dir, files)
    return web.Response(text="ok")


async def download_coeffs_zip(request):
    """
    Fetch one or several coeffcient files in a zip file.
    """
    coeff_dir = request.app["coeff_dir"]
    files = await request.json()
    zip_file = zip_of_files(coeff_dir, files)
    return await zip_response(request, zip_file, "coeffs.zip")


async def download_configs_zip(request):
    """
    Fetch one or several config files in a zip file.
    """
    config_dir = request.app["config_dir"]
    files = await request.json()
    zip_file = zip_of_files(config_dir, files)
    return await zip_response(request, zip_file, "configs.zip")


async def get_gui_config(request):
    """
    Get the gui configuration.
    """
    gui_config = get_gui_config_or_defaults()
    gui_config["coeff_dir"] = coeff_dir_relative_to_config_dir(request)
    gui_config["supported_capture_types"] = request.app["supported_capture_types"]
    gui_config["supported_playback_types"] = request.app["supported_playback_types"]
    gui_config["can_update_active_config"] = request.app["can_update_active_config"]
    logging.debug(f"GUI config: {str(gui_config)}")
    return web.json_response(gui_config)


async def get_defaults_for_coeffs(request):
    """
    Fetch reasonable settings for a coefficient file, based on file ending.
    """
    path = request.query["file"]
    absolute_path = make_absolute(path, request.app["config_dir"])
    defaults = defaults_for_filter(absolute_path)
    return web.json_response(defaults)


async def get_log_file(request):
    """
    Read and return the log file from the camilladsp process.
    """
    log_file_path = request.app["log_file"]
    try:
        with open(expanduser(log_file_path)) as log_file:
            text = log_file.read()
            return web.Response(body=text)
    except OSError:
        logging.error("Unable to read logfile at " + log_file_path)
    if log_file_path:
        error_message = "Please configure CamillaDSP to log to: " + log_file_path
    else:
        error_message = "Please configure a valid 'log_file' path"
    return web.Response(body=error_message)


async def get_capture_devices(request):
    """
    Get a list of available capture devices for a backend.
    """
    backend = request.match_info["backend"]
    cdsp = request.app["CAMILLA"]
    devs = cdsp.general.list_capture_devices(backend)
    return web.json_response(devs)


async def get_playback_devices(request):
    """
    Get a list of available playback devices for a backend.
    """
    backend = request.match_info["backend"]
    cdsp = request.app["CAMILLA"]
    devs = cdsp.general.list_playback_devices(backend)
    return web.json_response(devs)

async def get_backends(request):
    """
    Get lists of available playback and capture backends.
    """
    cdsp = request.app["CAMILLA"]
    backends = cdsp.general.supported_device_types()
    return web.json_response(backends)
