from aiohttp import web
from camilladsp import CamillaConnection

from settings import config
from routes import setup_routes, setup_static_routes

app = web.Application()
setup_routes(app)
setup_static_routes(app)
camillaconnection = CamillaConnection(config["camilla_host"], config["camilla_port"])
camillaconnection.connect()
app['CAMILLA'] = camillaconnection
web.run_app(app, port=config["port"])