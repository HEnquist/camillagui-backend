from aiohttp import web
from camilladsp import CamillaConnection
from offline import start_backup_cdsp
from settings import config
from routes import setup_routes, setup_static_routes
import sys

app = web.Application(client_max_size=1024 ** 3)
app["config_dir"] = config["config_dir"]
app["coeff_dir"] = config["coeff_dir"]
app["default_config"] = config["default_config"]
app["active_config"] = config["active_config"]
setup_routes(app)
setup_static_routes(app)

if len(sys.argv) > 1 and sys.argv[1] == "debug":
    # Add CORS to allow all, for testing only!
    import aiohttp_cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
    })
    # Configure CORS on all routes.
    for route in list(app.router.routes()):
        cors.add(route)
    print("WARNING: Allowing all requests! Use this for debugging only!")

camillaconnection = CamillaConnection(config["camilla_host"], config["camilla_port"])
#camillaconnection.connect()
app['CAMILLA'] = camillaconnection
app["BACKUP-CAMILLA"] = CamillaConnection("127.0.0.1", config["backup_camilla_port"])
start_backup_cdsp(config)
web.run_app(app, port=config["port"])
