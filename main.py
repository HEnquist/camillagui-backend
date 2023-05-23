from aiohttp import web
import logging
import sys
from camilladsp import CamillaClient
from camilladsp_plot.validate_config import CamillaValidator

from backend.version import VERSION
from backend.routes import setup_routes, setup_static_routes
from backend.settings import config
from backend.views import version_string


level = logging.WARNING
if len(sys.argv) > 1:
    level_str = sys.argv[1].upper()
    if level_str in ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"):
        level = getattr(logging, level_str)
    else:
        print(f"Unknown logging level {level_str}, using default WARNING")

logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("root").setLevel(level)

#logging.info("info")
#logging.debug("debug")
#logging.warning("warning")
#logging.error("error")

app = web.Application(client_max_size=1024 ** 3)  # set max upload file size to 1GB
app["config_dir"] = config["config_dir"]
app["coeff_dir"] = config["coeff_dir"]
app["default_config"] = config["default_config"]
app["statefile_path"] = config["statefile_path"]
app["log_file"] = config["log_file"]
app["on_set_active_config"] = config["on_set_active_config"]
app["on_get_active_config"] = config["on_get_active_config"]
app["supported_capture_types"] = config["supported_capture_types"]
app["supported_playback_types"] = config["supported_playback_types"]
app["can_update_active_config"] = config["can_update_active_config"]
setup_routes(app)
setup_static_routes(app)

app["CAMILLA"] = CamillaClient(config["camilla_host"], config["camilla_port"])
app["RECONNECT_THREAD"] = None
app["STATUSCACHE"] = {
    "backend_version": version_string(VERSION),
    "py_cdsp_version": version_string(app["CAMILLA"].versions.library())
    }
app["CACHETIME"] = 0
camillavalidator = CamillaValidator()
if config["supported_capture_types"] is not None:
    camillavalidator.set_supported_capture_types(config["supported_capture_types"])
if config["supported_playback_types"] is not None:
    camillavalidator.set_supported_playback_types(config["supported_playback_types"])
app["VALIDATOR"] = camillavalidator
web.run_app(app, port=config["port"])
