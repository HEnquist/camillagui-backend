import pathlib
import yaml

BASEPATH = pathlib.Path(__file__).parent.absolute()
config_path = BASEPATH/ 'config' / 'camillagui.yml'

def get_config(path):
    with open(path) as f:
        config = yaml.safe_load(f)
    return config

config = get_config(config_path)