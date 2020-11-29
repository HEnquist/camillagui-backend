from views import (
    get_param,
    get_list_param,
    set_param,
    eval_filter_values,
    eval_filterstep_values,
    eval_filter_svg,
    eval_filterstep_svg,
    eval_pipeline_svg,
    get_config,
    set_config,
    config_to_yml,
    yml_to_json,
    validate_config,
    get_version,
    get_library_version,
    get_backend_version,
    get_gui_index,
    get_stored_coeffs,
    get_stored_configs,
    store_config,
    store_coeff
)
import pathlib

BASEPATH = pathlib.Path(__file__).parent.absolute()


def setup_routes(app):
    app.router.add_get("/api/getparam/{name}", get_param)
    app.router.add_get("/api/getlistparam/{name}", get_list_param)
    app.router.add_post("/api/setparam/{name}", set_param)
    app.router.add_post("/api/evalfiltersvg", eval_filter_svg)
    app.router.add_post("/api/evalfilterstepsvg", eval_filterstep_svg)
    app.router.add_post("/api/evalfilter", eval_filter_values)
    app.router.add_post("/api/evalfilterstep", eval_filterstep_values)
    app.router.add_post("/api/evalpipelinesvg", eval_pipeline_svg)
    app.router.add_get("/api/getconfig", get_config)
    app.router.add_post("/api/setconfig", set_config)
    app.router.add_post("/api/configtoyml", config_to_yml)
    app.router.add_post("/api/ymltojson", yml_to_json)
    app.router.add_post("/api/validateconfig", validate_config)
    app.router.add_get("/api/version", get_version)
    app.router.add_get("/api/libraryversion", get_library_version)
    app.router.add_get("/api/backendversion", get_backend_version)
    app.router.add_get("/api/storedconfigs", get_stored_configs)
    app.router.add_get("/api/storedcoeffs", get_stored_coeffs)
    app.router.add_post("/api/uploadconfig", store_config)
    app.router.add_post("/api/uploadcoeff", store_coeff)

    app.router.add_get("/", get_gui_index)


def setup_static_routes(app):
    app.router.add_static("/gui/", path=BASEPATH / "build")
    app.router.add_static("/config/", path=app["config_dir"])
    app.router.add_static("/coeff/", path=app["coeff_dir"])
