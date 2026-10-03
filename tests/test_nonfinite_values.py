import pytest

from backend.dsp.validate_config import CamillaValidator

CONFIG = """
devices:
  samplerate: 48000
  chunksize: {chunksize}
  silence_threshold: {silence}
  capture: {{type: Stdin, channels: 2, format: S16_LE}}
  playback: {{type: Stdout, channels: 2, format: S16_LE}}
filters:
  peak: {{type: Biquad, parameters: {{type: Peaking, freq: {freq}, q: 1.0, gain: 3.0}}}}
  gain: {{type: Gain, parameters: {{gain: {gain}}}}}
  fir: {{type: Conv, parameters: {{type: Values, values: [1.0, {value}]}}}}
pipeline:
  - {{type: Filter, channels: [0, 1], names: [peak, gain, fir]}}
"""


def _errors(**values):
    fields = {
        "chunksize": "1024",
        "silence": "-60.0",
        "freq": "1000.0",
        "gain": "0.0",
        "value": "0.5",
    }
    fields.update(values)
    validator = CamillaValidator()
    validator.validate_yamlstring(CONFIG.format(**fields))
    return [(path, message) for path, message, severity in validator.get_errors()]


def test_finite_config_is_clean():
    assert _errors() == []


@pytest.mark.parametrize("spelling, parsed", [(".nan", "nan"), (".inf", "inf"), ("-.inf", "-inf")])
@pytest.mark.parametrize(
    "field, path, type_name",
    [
        ("chunksize", ["devices", "chunksize"], "'integer'"),
        ("silence", ["devices", "silence_threshold"], "'number', 'null'"),
        ("freq", ["filters", "peak", "parameters", "freq"], "'number'"),
        ("gain", ["filters", "gain", "parameters", "gain"], "'number'"),
        ("value", ["filters", "fir", "parameters", "values", 1], "'number'"),
    ],
)
def test_nonfinite_value_fails_the_type_check(spelling, parsed, field, path, type_name):
    # Only the type error, and no range message about the same value.
    assert _errors(**{field: spelling}) == [(path, f"{parsed} is not of type {type_name}")]
