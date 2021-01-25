from aiohttp import web
from camilladsp import CamillaError
from settings import gui_config_path

try:
    from camilladsp_plot import plot_pipeline, plot_filter, plot_filterstep
    PLOTTING = True
except ImportError:
    print("No plotting!")
    PLOTTING = False
from camilladsp_plot import eval_filter, eval_filterstep
import yaml
import os
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
    cdsp = request.app["CAMILLA"]
    if cdsp.is_connected():
        cdsp.set_config(json_config)
    else:
        backup = backup_cdsp(request)
        if backup:
            backup.validate_config(json_config)
    # If working_config is set, save new config to working_config
    working_config_file = request.app["working_config"]
    save_working_config = request.app["save_working_config"]
    if working_config_file and save_working_config:
        yaml_config = yaml.dump(json_config).encode('utf-8')
        with open(working_config_file, "wb") as f:
            f.write(yaml_config)
    return web.Response(text="OK")


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


async def get_working_config_file(request):
    working_config_file = request.app["working_config"]
    with open(working_config_file, 'r') as file:
        cdsp = cdsp_or_backup_cdsp(request)
        yaml_config = file.read()
        json_config = cdsp.read_config(yaml_config)
        return web.json_response(json_config)


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
    cdsp = request.app["CAMILLA"]
    vers_tup = cdsp.get_version()
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


async def store_coeff(request):
    data = await request.post()
    coeff = data["contents"]
    filename = coeff.filename
    coeff_file = coeff.file
    content = coeff_file.read()
    coeff_dir = request.app["coeff_dir"]
    with open(os.path.join(coeff_dir, filename), "wb") as f:
        f.write(content)
    return web.Response(
        text="Saved coeff file {} of {} bytes".format(filename, len(content))
    )


async def store_config(request):
    data = await request.post()
    config = data["contents"]
    filename = config.filename
    config_file = config.file
    content = config_file.read()
    config_dir = request.app["config_dir"]
    with open(os.path.join(config_dir, filename), "wb") as f:
        f.write(content)
    return web.Response(
        text="Saved config file {} of {} bytes".format(filename, len(content))
    )


async def get_stored_configs(request):
    config_dir = request.app["config_dir"]
    files = [os.path.abspath(os.path.join(config_dir, f)) for f in os.listdir(config_dir) if os.path.isfile(os.path.join(config_dir, f))]
    files_dict = {}
    for f in files:
        fname = os.path.basename(f)
        files_dict[fname] = f 
    return web.json_response(files_dict)


async def get_stored_coeffs(request):
    coeff_dir = request.app["coeff_dir"]
    files = [os.path.abspath(os.path.join(coeff_dir, f)) for f in os.listdir(coeff_dir) if os.path.isfile(os.path.join(coeff_dir, f))]
    print(files)
    files_dict = {}
    for f in files:
        fname = os.path.basename(f)
        files_dict[fname] = f 
    return web.json_response(files_dict)


async def get_gui_config(request):
    with open(gui_config_path) as yaml_config:
        json_config = yaml.safe_load(yaml_config)
    return web.json_response(json_config)