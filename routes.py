from camilladsp import plot_pipeline, plot_filter, CamillaError
import yaml
from views import gui, get_param, set_param, eval_filter, eval_pipeline, get_config, set_config, config_to_yml, yml_to_json, validate_config, get_version
import pathlib

BASEPATH = pathlib.Path(__file__).parent.absolute()

def setup_routes(app):
    #app.router.add_get('/gui/', gui)
    app.router.add_get('/api/getparam/{name}', get_param)
    app.router.add_post('/api/setparam/{name}', set_param)
    app.router.add_post('/api/evalfilter', eval_filter)
    app.router.add_post('/api/evalpipeline', eval_pipeline)
    app.router.add_get('/api/getconfig', get_config)
    app.router.add_post('/api/setconfig', set_config)
    app.router.add_post('/api/configtoyml', config_to_yml)
    app.router.add_post('/api/ymltojson', yml_to_json)
    app.router.add_post('/api/validateconfig', validate_config)
    app.router.add_get('/api/version', get_version)

def setup_static_routes(app):
    app.router.add_static('/gui/',
                          path=BASEPATH / 'build')
