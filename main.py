from aiohttp import web
import aiohttp_cors
from camilladsp import CamillaConnection

from settings import config
from routes import setup_routes, setup_static_routes

app = web.Application()
app["config_dir"] = config["config_dir"]
app["coeff_dir"] = config["coeff_dir"]
setup_routes(app)
setup_static_routes(app)


# Configure default CORS settings.
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

camillaconnection = CamillaConnection(config["camilla_host"], config["camilla_port"])
#camillaconnection.connect()
app['CAMILLA'] = camillaconnection
web.run_app(app, port=config["port"])