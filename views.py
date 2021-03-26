from os.path import isfile, join

from aiohttp import web
from camilladsp import CamillaError

from filemanagement import (
    path_of_configfile, store_files, list_of_files_in_directory, delete_files,
    zip_response, zip_of_files, get_yaml_as_json, set_as_active_config, get_active_config, save_to_active_config
)
from offline import cdsp_or_backup_cdsp, set_cdsp_config_or_validate_with_backup_cdsp
from settings import gui_config_path

try:
    from camilladsp_plot import plot_pipeline, plot_filter, plot_filterstep
    PLOTTING = True
except ImportError:
    print("No plotting!")
    PLOTTING = False
from camilladsp_plot import eval_filter, eval_filterstep
import yaml
from version import VERSION

SVG_PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text x="20" y="40">Plotting not available!</text></svg>'


async def get_gui_index(request):
    raise web.HTTPFound("/gui/index.html")


async def get_param(request):
    # Get a parameter value
    name = request.match_info["name"]
    print(name)
    cdsp = request.app["CAMILLA"]
    if name == "state":
        try:
            result = cdsp.get_state()
        except IOError:
            try:
                cdsp.connect()
                result = cdsp.get_state()
            except IOError:
                result = "offline"
    elif name == "volume":
        result = cdsp.get_volume()
    elif name == "signalrange":
        result = cdsp.get_signal_range()
    elif name == "signalrangedb":
        result = cdsp.get_signal_range_dB()
    elif name == "capturerateraw":
        result = cdsp.get_capture_rate_raw()
    elif name == "capturerate":
        result = cdsp.get_capture_rate()
    elif name == "rateadjust":
        result = cdsp.get_rate_adjust()
    elif name == "updateinterval":
        result = cdsp.get_update_interval()
    elif name == "configname":
        result = cdsp.get_config_name()
    elif name == "configraw":
        result = cdsp.get_config_raw()
    elif name == "bufferlevel":
        result = cdsp.get_buffer_level()
    elif name == "clippedsamples":
        result = cdsp.get_clipped_samples()
    else:
        result = "ERROR"
    print(result)
    return web.Response(text=str(result))


async def get_list_param(request):
    # Get a parameter value as a list
    name = request.match_info["name"]
    print(name)
    cdsp = request.app["CAMILLA"]
    if name == "capturesignalrms":
        result = cdsp.get_capture_signal_rms()
    elif name == "capturesignalpeak":
        result = cdsp.get_capture_signal_peak()
    elif name == "playbacksignalrms":
        result = cdsp.get_playback_signal_rms()
    elif name == "playbacksignalpeak":
        result = cdsp.get_playback_signal_peak()
    else:
        result = "[]"
    print(result)
    return web.json_response(result)


async def set_param(request):
    # Set a parameter
    value = await request.text()
    name = request.match_info["name"]
    # value = request.get_data().decode()
    print(name, value)
    cdsp = request.app["CAMILLA"]
    if name == "volume":
        cdsp.set_volume(value)
    elif name == "updateinterval":
        cdsp.set_update_interval(value)
    elif name == "configname":
        cdsp.set_config_name(value)
    elif name == "configraw":
        cdsp.set_config_raw(value)
    return web.Response(text="OK")


async def eval_filter_svg(request):
    # Plot a filter
    if PLOTTING:
        content = await request.json()
        print("content", content)
        image = plot_filter(
            content["config"],
            name=content["name"],
            samplerate=content["samplerate"],
            npoints=1000,
            toimage=True,
        )
    else:
        image = SVG_PLACEHOLDER
    return web.Response(body=image, content_type="image/svg+xml")


async def eval_filter_values(request):
    # Plot a filter
    content = await request.json()
    print("content", content)
    data = eval_filter(
        content["config"],
        name=content["name"],
        samplerate=content["samplerate"],
        npoints=300,
    )
    return web.json_response(data)


async def eval_filterstep_svg(request):
    # Plot a filter
    if PLOTTING:
        content = await request.json()
        print("content", content)
        image = plot_filterstep(
            content["config"],
            content["index"],
            name="Filterstep {}".format(content["index"]),
            npoints=300,
            toimage=True,
        )
    else:
        image = SVG_PLACEHOLDER
    return web.Response(body=image, content_type="image/svg+xml")


async def eval_filterstep_values(request):
    # Plot a filter
    content = await request.json()
    print("content", content)
    data = eval_filterstep(
        content["config"],
        content["index"],
        name="Filterstep {}".format(content["index"]),
        npoints=1000,
    )
    return web.json_response(data)


async def eval_pipeline_svg(request):
    # Plot a pipeline
    if PLOTTING:
        content = await request.json()
        print("content", content)
        image = plot_pipeline(content, toimage=True)
    else:
        image = SVG_PLACEHOLDER
    return web.Response(body=image, content_type="image/svg+xml")


async def get_config(request):
    # Get running config
    cdsp = request.app["CAMILLA"]
    config = cdsp.get_config()
    return web.json_response(config)


async def set_config(request):
    # Apply a new config to CamillaDSP
    json_config = await request.json()
    try:
        set_cdsp_config_or_validate_with_backup_cdsp(json_config, request)
    except CamillaError as e:
        return web.Response(status=500, text=str(e))
    save_to_active_config(json_config, request)
    return web.Response(text="OK")


async def get_active_config_file(request):
    active_config = request.app["active_config"]
    default_config = request.app["default_config"]
    if active_config and isfile(active_config):
        config = active_config
    elif default_config and isfile(default_config):
        config = default_config
    else:
        return web.Response(status=404, text="No active or default config")
    try:
        json_config = get_yaml_as_json(request, config)
    except CamillaError as e:
        return web.Response(status=500, text=str(e))
    active_config_name = get_active_config(request.app["active_config"])
    if active_config_name:
        json = {"configFileName": active_config_name, "config": json_config}
    else:
        json = {"config": json_config}
    return web.json_response(json)


async def get_config_file(request):
    config_name = request.query["name"]
    config_file = path_of_configfile(request, config_name)
    try:
        json_config = get_yaml_as_json(request, config_file)
        set_as_active_config(request.app["active_config"], config_file)
    except CamillaError as e:
        return web.Response(status=500, text=str(e))
    return web.json_response(json_config)


async def save_config_file(request):
    json = await request.json()
    config_name = json["filename"]
    json_config = json["config"]
    config_file = path_of_configfile(request, config_name)
    yaml_config = yaml.dump(json_config).encode('utf-8')
    with open(config_file, "wb") as f:
        f.write(yaml_config)
    set_as_active_config(request.app["active_config"], config_file)
    return web.Response(text="OK")


async def config_to_yml(request):
    # Convert a json config to yml string (for saving to disk etc)
    content = await request.json()
    conf_yml = yaml.dump(content)
    return web.Response(text=conf_yml)


async def yml_to_json(request):
    # Parse a yml string and return as json
    config_ymlstr = await request.text()
    cdsp = cdsp_or_backup_cdsp(request)
    config = cdsp.read_config(config_ymlstr)
    return web.json_response(config)


async def validate_config(request):
    # Validate a config, returned completed config
    config = await request.json()
    cdsp = cdsp_or_backup_cdsp(request)
    try:
        _val_config = cdsp.validate_config(config)
    except CamillaError as e:
        return web.Response(text=str(e))
    return web.Response(text="OK")


async def get_version(request):
    cdsp = cdsp_or_backup_cdsp(request)
    vers_tup = cdsp.get_version()
    if vers_tup is None:
        version = {"major": "x", "minor": "x", "patch": "x"}
    else:
        version = {"major": vers_tup[0], "minor": vers_tup[1], "patch": vers_tup[2]}
    return web.json_response(version)


async def get_library_version(request):
    cdsp = request.app["CAMILLA"]
    vers_tup = cdsp.get_library_version()
    version = {"major": vers_tup[0], "minor": vers_tup[1], "patch": vers_tup[2]}
    return web.json_response(version)


async def get_backend_version(request):
    version = {"major": VERSION[0], "minor": VERSION[1], "patch": VERSION[2]}
    return web.json_response(version)


async def store_coeffs(request):
    folder = request.app["coeff_dir"]
    return await store_files(folder, request)


async def store_configs(request):
    folder = request.app["config_dir"]
    return await store_files(folder, request)


async def get_stored_coeffs(request):
    coeff_dir = request.app["coeff_dir"]
    coeffs = list_of_files_in_directory(coeff_dir)
    return web.json_response(coeffs)


async def get_stored_configs(request):
    config_dir = request.app["config_dir"]
    configs = list_of_files_in_directory(config_dir)
    return web.json_response(configs)


async def delete_coeffs(request):
    coeff_dir = request.app["coeff_dir"]
    files = await request.json()
    delete_files(coeff_dir, files)
    return web.Response(text="ok")


async def delete_configs(request):
    config_dir = request.app["config_dir"]
    files = await request.json()
    delete_files(config_dir, files)
    return web.Response(text="ok")


async def download_coeffs_zip(request):
    coeff_dir = request.app["coeff_dir"]
    files = await request.json()
    zip_file = zip_of_files(coeff_dir, files)
    return await zip_response(request, zip_file, "coeffs.zip")


async def download_configs_zip(request):
    config_dir = request.app["config_dir"]
    files = await request.json()
    zip_file = zip_of_files(config_dir, files)
    return await zip_response(request, zip_file, "configs.zip")


async def get_gui_config(request):
    with open(gui_config_path) as yaml_config:
        json_config = yaml.safe_load(yaml_config)
        json_config["coeff_dir"] = join(request.app["coeff_dir"], '')  # append folder separator at the end
    return web.json_response(json_config)