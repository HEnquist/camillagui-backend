from aiohttp import web
from camilladsp import CamillaConnection
from offline import start_backup_cdsp
from settings import config
from routes import setup_routes, setup_static_routes

app = web.Application()
app["config_dir"] = config["config_dir"]
app["coeff_dir"] = config["coeff_dir"]
app["default_config"] = config["default_config"]
app["active_config"] = config["active_config"]
setup_routes(app)
setup_static_routes(app)

camillaconnection = CamillaConnection(config["camilla_host"], config["camilla_port"])
#camillaconnection.connect()
app['CAMILLA'] = camillaconnection
app["BACKUP-CAMILLA"] = CamillaConnection("127.0.0.1", config["backup_camilla_port"])
start_backup_cdsp(config)
web.run_app(app, port=config["port"])
