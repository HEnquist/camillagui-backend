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
    path_of_configfile,
    store_files,
    list_of_files_in_directory,
    delete_files,
    zip_response,
    zip_of_files,
    read_yaml_from_path_to_object,
    set_path_as_active_config,
    get_active_config_path,
    save_config_to_yaml_file,
    make_config_filter_paths_absolute,
    coeff_dir_relative_to_config_dir,
    replace_relative_filter_path_with_absolute_paths,
    make_config_filter_paths_relative,
    make_absolute,
    replace_tokens_in_filter_config,
    list_of_filenames_in_directory,
)
from .filters import (
    defaults_for_filter,
    filter_plot_options,
    pipeline_step_plot_options,
)
from .settings import get_gui_config_or_defaults
from .convolver_config_import import ConvolverConfig
from .eqapo_config_import import EqAPO
from .legacy_config_import import migrate_legacy_config

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
    "processingload": None,
}
HEADERS = {"Cache-Control": "no-store"}


async def get_gui_index(request):
    """
    Serve the static gui files.
    """
    raise web.HTTPFound("/gui/index.html")


def _reconnect(cdsp, cache, validator):
    done = False
    while not done:
        try:
            cdsp.connect()
            cache["cdsp_version"] = version_string(cdsp.versions.camilladsp())
            # Update backends
            backends = cdsp.general.supported_device_types()
            cache["backends"] = backends
            pb_backends, cap_backends = backends
            logging.debug(f"Updated backends: {backends}")
            validator.set_supported_capture_types(cap_backends)
            validator.set_supported_playback_types(pb_backends)
            # Update playback and capture devices
            for pb_backend in pb_backends:
                pb_devs = cdsp.general.list_playback_devices(pb_backend)
                logging.debug(f"Updated {pb_backend} playback devices: {pb_devs}")
                cache["playback_devices"][pb_backend] = pb_devs
            for cap_backend in cap_backends:
                cap_devs = cdsp.general.list_capture_devices(cap_backend)
                logging.debug(f"Updated {cap_backend} capture devices: {cap_devs}")
                cache["capture_devices"][cap_backend] = cap_devs
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
    reconnect_thread = request.app["STORE"]["reconnect_thread"]
    cache = request.app["STATUSCACHE"]
    cachetime = request.app["STORE"]["cache_time"]
    validator = request.app["VALIDATOR"]
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
            cache.update(
                {
                    "capturesignalrms": levels["capture_rms"],
                    "capturesignalpeak": levels["capture_peak"],
                    "playbacksignalrms": levels["playback_rms"],
                    "playbacksignalpeak": levels["playback_peak"],
                }
            )
            now = time.time()
            # These values don't change that fast, let's update them only once per second.
            if now - cachetime > 1.0:
                request.app["STORE"]["cache_time"] = now
                cache.update(
                    {
                        "capturerate": cdsp.rate.capture(),
                        "rateadjust": cdsp.status.rate_adjust(),
                        "bufferlevel": cdsp.status.buffer_level(),
                        "clippedsamples": cdsp.status.clipped_samples(),
                        "processingload": cdsp.status.processing_load(),
                    }
                )
        except IOError as e:
            print("TODO safe to remove this try-except? error:", e)
            pass
    except IOError:
        if reconnect_thread is None or not reconnect_thread.is_alive():
            cache.update(OFFLINE_CACHE)
            reconnect_thread = threading.Thread(
                target=_reconnect, args=(cdsp, cache, validator), daemon=True
            )
            reconnect_thread.start()
            request.app["STORE"]["reconnect_thread"] = reconnect_thread
    return web.json_response(cache, headers=HEADERS)


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
    return web.Response(text=str(result), headers=HEADERS)


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
    return web.json_response(result, headers=HEADERS)


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
    return web.Response(text="OK", headers=HEADERS)


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
    filter_file_names = list_of_filenames_in_directory(request.app["coeff_dir"])
    if "filename" in config["parameters"]:
        filename = config["parameters"]["filename"]
        options = filter_plot_options(filter_file_names, filename)
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
        return web.json_response(data, headers=HEADERS)
    except FileNotFoundError:
        raise web.HTTPNotFound(text="Filter coefficient file not found")
    except Exception as e:
        raise web.HTTPBadRequest(text=str(e))


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
    filter_file_names = list_of_filenames_in_directory(request.app["coeff_dir"])
    options = pipeline_step_plot_options(filter_file_names, config, step_index)
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
        return web.json_response(data, headers=HEADERS)
    except FileNotFoundError:
        raise web.HTTPNotFound(text="Filter coefficient file not found")
    except Exception as e:
        raise web.HTTPBadRequest(text=str(e))


async def get_config(request):
    """
    Get running config.
    """
    cdsp = request.app["CAMILLA"]
    config = cdsp.config.active()
    return web.json_response(config, headers=HEADERS)


async def set_config(request):
    """
    Apply a new config to CamillaDSP.
    """
    json = await request.json()
    config_object = json["config"]
    config_dir = request.app["config_dir"]
    cdsp = request.app["CAMILLA"]
    validator = request.app["VALIDATOR"]
    config_object_with_absolute_filter_paths = make_config_filter_paths_absolute(
        config_object, config_dir
    )
    if cdsp.is_connected():
        try:
            cdsp.config.set_active(config_object_with_absolute_filter_paths)
        except CamillaError as e:
            raise web.HTTPInternalServerError(text=str(e))
    else:
        validator.validate_config(config_object_with_absolute_filter_paths)
        errors = validator.get_errors()
        if len(errors) > 0:
            return web.json_response(data=errors, headers=HEADERS)
    return web.Response(text="OK", headers=HEADERS)


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
        config_object = make_config_filter_paths_relative(
            read_yaml_from_path_to_object(request, config), config_dir
        )
    except CamillaError as e:
        logging.error(f"Failed to get default config file, error: {e}")
        raise web.HTTPInternalServerError(text=str(e))
    except Exception as e:
        logging.error("Failed to get default config file")
        traceback.print_exc()
        raise web.HTTPInternalServerError(text=str(e))
    return web.json_response(config_object, headers=HEADERS)


async def get_active_config_file(request):
    """
    Get the active config. If no config is active, return the default config.
    """
    active_config_path = get_active_config_path(request)
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
        config_object = make_config_filter_paths_relative(
            read_yaml_from_path_to_object(request, config), config_dir
        )
    except CamillaError as e:
        logging.error(f"Failed to get active config from CamillaDSP, error: {e}")
        raise web.HTTPInternalServerError(text=str(e))
    except Exception as e:
        logging.error(f"Failed to get active config")
        traceback.print_exc()
        raise web.HTTPInternalServerError(text=str(e))
    if active_config_path:
        data = {"configFileName": active_config_path, "config": config_object}
    else:
        data = {"config": config_object}
    return web.json_response(data, headers=HEADERS)


async def set_active_config_name(request):
    """
    Persístently set the given config file name as the active config.
    """
    json = await request.json()
    config_name = json["name"]
    config_file = path_of_configfile(request, config_name)
    set_path_as_active_config(request, config_file)
    return web.Response(text="OK", headers=HEADERS)


async def get_config_file(request):
    """
    Read and return a config file. Takes a filname and tries to load the file from config_dir.
    """
    config_dir = request.app["config_dir"]
    config_name = request.query["name"]
    config_file = path_of_configfile(request, config_name)
    try:
        config_object = make_config_filter_paths_relative(
            read_yaml_from_path_to_object(request, config_file), config_dir
        )
    except CamillaError as e:
        raise web.HTTPInternalServerError(text=str(e))
    return web.json_response(config_object, headers=HEADERS)


async def save_config_file(request):
    """
    Save a config to a given filename.
    """
    content = await request.json()
    save_config_to_yaml_file(content["filename"], content["config"], request)
    return web.Response(text="OK", headers=HEADERS)


async def config_to_yml(request):
    """
    Convert a json config to yaml string (for saving to disk etc).
    """
    content = await request.json()
    conf_yml = yaml.dump(content)
    return web.Response(text=conf_yml, headers=HEADERS)


async def parse_and_validate_yml_config_to_json(request):
    """
    Parse a yaml config string and return serialized as json.
    """
    config_yaml = await request.text()
    validator = request.app["VALIDATOR"]
    validator.validate_yamlstring(config_yaml)
    config = validator.get_config()
    return web.json_response(config, headers=HEADERS)


async def yaml_to_json(request):
    """
    Parse a yaml string and return serialized as json.
    This could also be just a partial config.
    The config is migrated from older camilladsp versions if needed.
    """
    config_yaml = await request.text()
    loaded = yaml.safe_load(config_yaml)
    migrate_legacy_config(loaded)
    return web.json_response(loaded, headers=HEADERS)


async def translate_convolver_to_json(request):
    """
    Parse a Convolver config string and return
    as a CamillaDSP config serialized as json.
    """
    config = await request.text()
    translated = ConvolverConfig(config).to_object()
    return web.json_response(translated, headers=HEADERS)


async def translate_eqapo_to_json(request):
    """
    Parse a Convolver config string and return
    as a CamillaDSP config serialized as json.
    """
    try:
        channels = int(request.rel_url.query.get("channels", None))
    except (ValueError, TypeError) as e:
        raise web.HTTPBadRequest(reason=str(e))
    print(channels)
    config = await request.text()
    converter = EqAPO(config, channels)
    converter.translate_file()
    translated = converter.build_config()
    return web.json_response(translated, headers=HEADERS)


async def validate_config(request):
    """
    Validate a config, returned a list of errors or OK.
    """
    config_dir = request.app["config_dir"]
    config = await request.json()
    config_with_absolute_filter_paths = make_config_filter_paths_absolute(
        config, config_dir
    )
    validator = request.app["VALIDATOR"]
    validator.validate_config(config_with_absolute_filter_paths)
    # print(yaml.dump(config_with_absolute_filter_paths, indent=2))
    errors = validator.get_errors()
    if len(errors) > 0:
        logging.debug(errors)
        return web.json_response(status=406, data=errors)
    return web.Response(text="OK", headers=HEADERS)


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
    return web.json_response(coeffs, headers=HEADERS)


async def get_stored_configs(request):
    """
    Fetch a list of config files in config_dir.
    """
    config_dir = request.app["config_dir"]
    configs = list_of_files_in_directory(config_dir)
    return web.json_response(configs, headers=HEADERS)


async def delete_coeffs(request):
    """
    Delete one or several coefficient files from coeff_dir.
    """
    coeff_dir = request.app["coeff_dir"]
    files = await request.json()
    delete_files(coeff_dir, files)
    return web.Response(text="ok", headers=HEADERS)


async def delete_configs(request):
    """
    Delete one or several config files from config_dir.
    """
    config_dir = request.app["config_dir"]
    files = await request.json()
    delete_files(config_dir, files)
    return web.Response(text="ok", headers=HEADERS)


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
    return web.json_response(gui_config, headers=HEADERS)


async def get_defaults_for_coeffs(request):
    """
    Fetch reasonable settings for a coefficient file, based on file ending.
    """
    path = request.query["file"]
    absolute_path = make_absolute(path, request.app["config_dir"])
    defaults = defaults_for_filter(absolute_path)
    return web.json_response(defaults, headers=HEADERS)


async def get_log_file(request):
    """
    Read and return the log file from the camilladsp process.
    """
    log_file_path = request.app["log_file"]
    try:
        with open(expanduser(log_file_path)) as log_file:
            text = log_file.read()
            return web.Response(body=text, headers=HEADERS)
    except OSError:
        logging.error("Unable to read logfile at " + log_file_path)
    if log_file_path:
        error_message = "Please configure CamillaDSP to log to: " + log_file_path
    else:
        error_message = "Please configure a valid 'log_file' path"
    return web.Response(body=error_message, headers=HEADERS)


async def get_capture_devices(request):
    """
    Get a list of available capture devices for a backend.
    Return a cached list if CamillaDSP is offline.
    """
    backend = request.match_info["backend"]
    cdsp = request.app["CAMILLA"]
    try:
        devs = cdsp.general.list_capture_devices(backend)
    except IOError:
        logging.debug("CamillaDSP is offline, returning capture devices from cache")
        devs = request.app["STATUSCACHE"]["capture_devices"].get(backend, [])
    return web.json_response(devs, headers=HEADERS)


async def get_playback_devices(request):
    """
    Get a list of available playback devices for a backend.
    Return a cached list if CamillaDSP is offline.
    """
    backend = request.match_info["backend"]
    cdsp = request.app["CAMILLA"]
    try:
        devs = cdsp.general.list_playback_devices(backend)
    except IOError:
        logging.debug("CamillaDSP is offline, returning playback devices from cache")
        devs = request.app["STATUSCACHE"]["playback_devices"].get(backend, [])
    return web.json_response(devs, headers=HEADERS)


async def get_backends(request):
    """
    Get lists of available playback and capture backends.
    Since this can not change while CamillaDSP is running,
    the response is taken from the cache.
    """
    backends = request.app["STATUSCACHE"]["backends"]
    return web.json_response(backends, headers=HEADERS)
