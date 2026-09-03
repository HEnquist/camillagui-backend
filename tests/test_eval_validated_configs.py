"""Check that eval_filter accepts every filter config the validator accepts.

Configs are generated from the schema files: one variant with only the
required properties, one per optional choice property (q, bandwidth or
slope), and one with all properties. Each variant is wrapped in a
complete config and checked with CamillaValidator. Variants that fail
validation are skipped. Every variant that validates must evaluate
without raising, both as written and after validation has filled in
the schema defaults, which includes explicit nulls.
"""
import copy
import json
import re
from pathlib import Path

import pytest

from backend.dsp.eval_filterconfig import eval_filter
from backend.dsp.validate_config import CamillaValidator

SCHEMA_DIR = Path(__file__).parent.parent / "backend" / "dsp" / "schemas"

SAMPLE = {
    "freq": 1000.0, "q": 1.0, "gain": 3.0, "slope": 6.0, "bandwidth": 1.0,
    "order": 4, "freq_p": 2000.0, "freq_z": 1000.0, "q_p": 2.0,
    "normalize_at_dc": False, "freq_act": 60.0, "q_act": 0.7,
    "freq_target": 30.0, "q_target": 0.8,
    "a1": -0.2, "a2": 0.1, "b0": 0.9, "b1": 0.1, "b2": -0.05,
    # NPointPeq: rising frequency, first is the low shelf and last the high shelf
    "bands": [
        {"freq": 100.0, "q": 0.7, "gain": 3.0},
        {"freq": 1000.0, "q": 1.0, "gain": -2.0},
        {"freq": 8000.0, "q": 0.7, "gain": 3.0},
    ],
    "freq_min": 20.0, "freq_max": 20000.0, "gains": [0.0, 3.0, 0.0],
    "delay": 3.0, "delay_unit": "ms", "subsample": False,
    "inverted": False, "mute": False, "scale": "dB",
    "ramp_time_ms": 400.0, "fader": "Aux1",
    # valid for both Volume (-150 to 50) and LookaheadLimiter (max 0)
    "limit": -10.0,
    "attack": 1.0, "attack_unit": "ms",
    "release": 100.0, "release_unit": "ms",
    "reference_level": -25.0, "high_boost": 10.0, "low_boost": 10.0,
    "high_freq": 3500.0, "low_freq": 70.0, "high_q": 0.7, "low_q": 0.7,
    "attenuate_mid": False,
    "soft_clip": False, "clip_limit": -3.0,
    "bits": 16, "amplitude": 0.5,
    "a": [1.0, -0.1], "b": [1.0, 0.2],
    "values": [1.0, 0.5], "length": 1024,
}

SCHEMA_FILES = {
    "Biquad": "biquads.json",
    "BiquadCombo": "biquadcombo.json",
    "Conv": "conv.json",
    "Dither": "dither.json",
}

# The only rejections this test may skip over: q is mutually exclusive with
# bandwidth and with slope, so the generated "all properties" variant always
# supplies both, and the "required" variant supplies neither. Anything else
# means the validator has broken, and must fail rather than silently skip.
EXPECTED_REJECTION = re.compile(
    r"(Missing|Both) '(bandwidth|slope|q)' (or|and) '(bandwidth|slope|q)'"
)

# Raw and Wav read coefficient files from disk, not usable here.
SKIP_SUBTYPES = {("Conv", "Raw"), ("Conv", "Wav")}


def build_cases():
    cases = []

    def add(ftype, subtype, sch):
        props = [k for k in sch.get("properties", {}) if k != "type"]
        req = [k for k in sch.get("required", []) if k != "type"]
        variants = {"required": req}
        for alt in ("q", "bandwidth", "slope"):
            if alt in props and alt not in req:
                variants[f"required+{alt}"] = req + [alt]
        if set(props) != set(req):
            variants["all"] = props
        for vname, keys in variants.items():
            missing = [k for k in keys if k not in SAMPLE]
            if missing:
                raise KeyError(
                    f"No sample value for {missing} in the {ftype}/{subtype} schema. "
                    f"Add an entry to SAMPLE in {Path(__file__).name}."
                )
            params = {k: SAMPLE[k] for k in keys}
            if subtype is not None:
                params["type"] = subtype
            cases.append(
                pytest.param(ftype, params, id=f"{ftype}-{subtype}-{vname}")
            )

    for ftype, fname in SCHEMA_FILES.items():
        schemas = json.loads((SCHEMA_DIR / fname).read_text())
        for subtype, sch in schemas.items():
            if subtype == ftype or (ftype, subtype) in SKIP_SUBTYPES:
                continue
            add(ftype, subtype, sch)

    basics = json.loads((SCHEMA_DIR / "basicfilters.json").read_text())
    for ftype, sch in basics.items():
        add(ftype, None, sch)

    return cases


@pytest.mark.parametrize("ftype,params", build_cases())
def test_eval_accepts_validated_config(ftype, params):
    filterconf = {"type": ftype, "parameters": params}
    config = {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "capture": {
                "type": "Alsa",
                "device": "hw:0",
                "channels": 2,
                "format": "S16_LE",
            },
            "playback": {
                "type": "Alsa",
                "device": "hw:0",
                "channels": 2,
                "format": "S16_LE",
            },
        },
        "filters": {"testfilter": filterconf},
        "pipeline": [{"type": "Filter", "channels": [0], "names": ["testfilter"]}],
    }
    validator = CamillaValidator()
    validator.validate_config(copy.deepcopy(config))
    errors = [e for e in validator.get_errors() if e[2] == "error"]
    if errors:
        message = errors[0][1]
        if not EXPECTED_REJECTION.search(message):
            pytest.fail(f"validator unexpectedly rejects this config: {message}")
        pytest.skip(f"validator rejects this config: {message}")
    # volume below reference_level, otherwise Loudness clamps its boosts
    # to zero and its parameter arithmetic is never executed
    # the GUI backend evaluates the config as the user wrote it
    result = eval_filter(filterconf, samplerate=48000, npoints=100, volume=-45.0)
    assert len(result["magnitude"]) == 100
    assert len(result["phase"]) == 100
    # the backend also evaluates configs after validation has filled in
    # the schema defaults, where optional keys are explicit nulls
    filled = validator.get_config()["filters"]["testfilter"]
    result = eval_filter(filled, samplerate=48000, npoints=100, volume=-45.0)
    assert len(result["magnitude"]) == 100
    assert len(result["phase"]) == 100
