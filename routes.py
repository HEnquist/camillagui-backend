from views import get_param, set_param, eval_filter, eval_filterstep, eval_pipeline, get_config, set_config, config_to_yml, yml_to_json, validate_config, get_version, get_gui_index
import pathlib

BASEPATH = pathlib.Path(__file__).parent.absolute()

def setup_routes(app):
    app.router.add_get('/api/getparam/{name}', get_param)
    app.router.add_post('/api/setparam/{name}', set_param)
    app.router.add_post('/api/evalfilter', eval_filter)
    app.router.add_post('/api/evalfilterstep', eval_filterstep)
    app.router.add_post('/api/evalpipeline', eval_pipeline)
    app.router.add_get('/api/getconfig', get_config)
    app.router.add_post('/api/setconfig', set_config)
    app.router.add_post('/api/configtoyml', config_to_yml)
    app.router.add_post('/api/ymltojson', yml_to_json)
    app.router.add_post('/api/validateconfig', validate_config)
    app.router.add_get('/api/version', get_version)
    app.router.add_get('/', get_gui_index)
    

def setup_static_routes(app):
    app.router.add_static('/gui/',
                          path=BASEPATH / 'build')
