import yaml
import os

from jinja2 import Environment, FileSystemLoader

from backend.version import VERSION

script_dir = os.path.dirname(__file__)

with open(os.path.join(script_dir, "versions.yml")) as f:
    versions = yaml.safe_load(f)

versions["backend_version"] = ".".join(str(v) for v in VERSION)

environment = Environment(loader=FileSystemLoader(os.path.join(script_dir, "templates/")))

filenames = [
    "requirements.txt",
    "cdsp_conda.yml",
    "pyproject.toml",
]

for filename in filenames:
    t = environment.get_template(filename + ".j2")

    # render and write
    rendered = t.render(versions)
    with open(filename, mode="w", encoding="utf-8") as f:
        f.write(rendered)
