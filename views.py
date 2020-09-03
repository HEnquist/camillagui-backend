from aiohttp import web
from camilladsp import CamillaError
from camilladsp_plot import plot_pipeline, plot_filter, plot_filterstep
import yaml

async def get_gui_index(request):
    raise web.HTTPFound('/gui/index.html')

async def get_param(request):
    # Get a parameter value
    name = request.match_info['name']
    print(name)
    cdsp = request.app['CAMILLA']
    if name == "state":
        try:
            result = cdsp.get_state()
        except IOError:
            try:
                cdsp.connect()
                result = cdsp.get_state()
            except IOError:
                result = "offline"
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
    else:
        result = "ERROR"
    print(result)
    return web.Response(text=str(result))

async def set_param(request):
    # Set a parameter
    value = await request.text()
    name = request.match_info['name']
    #value = request.get_data().decode()
    print(name, value)
    cdsp = request.app['CAMILLA']
    if name == "updateinterval":
        cdsp.set_update_interval(value)
    elif name == "configname":
        cdsp.set_config_name(value)     
    elif name == "configraw":
        cdsp.set_config_raw(value)
    return web.Response(text="OK")


async def eval_filter(request):
    # Plot a filter
    content = await request.json()
    print("content", content)
    image=plot_filter(content["config"], name=content["name"], samplerate=content["samplerate"], npoints=1000, toimage=True)
    return web.Response(body=image, content_type='image/svg+xml')

async def eval_filterstep(request):
    # Plot a filter
    content = await request.json()
    print("content", content)
    image=plot_filterstep(content["config"], content["index"], name="Filterstep {}".format(content["index"]), npoints=1000, toimage=True)
    return web.Response(body=image, content_type='image/svg+xml')

async def eval_pipeline(request):
    # Plot a pipeline
    content = await request.json()
    print("content", content)
    image=plot_pipeline(content, toimage=True)
    return web.Response(body=image, content_type='image/svg+xml')

async def get_config(request):
    # Get running config
    cdsp = request.app['CAMILLA']
    config = cdsp.get_config()
    return web.json_response(config)

async def set_config(request):
    # Apply a new config to CamillaDSP
    content = await request.json()
    cdsp = request.app['CAMILLA']
    cdsp.set_config(content)
    return web.Response(text="OK")

async def config_to_yml(request):
    # Convert a json config to yml string (for saving to disk etc)
    content = await request.json()
    conf_yml = yaml.dump(content)
    return web.Response(text=conf_yml)

async def yml_to_json(request):
    # Parse a yml string and return as json
    config_ymlstr = await request.text()
    cdsp = request.app['CAMILLA']
    config = cdsp.read_config(config_ymlstr)
    return web.json_response(config)

async def validate_config(request):
    # Validate a config, returned completed config
    config = await request.json()
    cdsp = request.app['CAMILLA']
    try:
        _val_config = cdsp.validate_config(config)
    except CamillaError as e:
        return web.Response(text=str(e))
    return web.Response(text="OK")

async def get_version(request):
    cdsp = request.app['CAMILLA']
    vers_tup = cdsp.get_version()
    version = {"major": vers_tup[0], "minor": vers_tup[1], "patch": vers_tup[2]}
    return web.json_response(version)



