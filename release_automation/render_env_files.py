import os
import sys

import yaml
from jinja2 import Environment, FileSystemLoader

from backend.version import VERSION

script_dir = os.path.dirname(__file__)

with open(os.path.join(script_dir, "versions.yml")) as f:
    versions = yaml.safe_load(f)

versions["backend_version"] = VERSION

environment = Environment(
    loader=FileSystemLoader(os.path.join(script_dir, "templates/"))
)

filenames = [
    "requirements.txt",
    "cdsp_conda.yml",
    "pyproject.toml",
]

# Written to the directory given as the first argument, by default the current one.
output_dir = sys.argv[1] if len(sys.argv) > 1 else "."

for filename in filenames:
    t = environment.get_template(filename + ".j2")

    # render and write
    rendered = t.render(versions)
    with open(os.path.join(output_dir, filename), mode="w", encoding="utf-8") as f:
        f.write(rendered)
