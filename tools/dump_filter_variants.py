"""Generate every schema-valid filter config, for the frontend's evaluator to chew on.

The filter evaluator moved to the frontend, but the JSON schemas stayed here.
That would have broken the coupling between the two: a new schema property
would no longer have anything proving the evaluator handles it. This tool keeps
the coupling by exporting the variants themselves.

It writes one config per schema variant, with only the required properties, one
per optional choice property, and one with everything, each in both the form
the user writes and the form the validator leaves behind once it has filled in
the schema defaults as explicit nulls. `variants.test.ts` on the frontend
evaluates all of them.

Run it whenever a filter schema changes; `test_eval_validated_configs.py` fails
until you do.

    python tools/dump_filter_variants.py
"""

import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.dsp.validate_config import CamillaValidator  # noqa: E402

SCHEMA_DIR = Path(__file__).parent.parent / "backend" / "dsp" / "schemas"

# Assumes the two repos are checked out side by side.
DEFAULT_OUTPUT = (
    Path(__file__).parent.parent.parent
    / "camillagui"
    / "src"
    / "camilladsp"
    / "eval"
    / "fixtures"
    / "variants.json"
)

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

# The only rejections this generator may skip over: q is mutually exclusive
# with bandwidth and with slope, so the generated "all properties" variant
# always supplies both, and the "required" variant supplies neither. Anything
# else means the validator has broken, and must raise rather than silently skip.
EXPECTED_REJECTION = re.compile(
    r"(Missing|Both) '(bandwidth|slope|q)' (or|and) '(bandwidth|slope|q)'"
)

# Raw and Wav read coefficient files from disk, which the frontend gets from
# /api/convcoeffs rather than evaluating from the config alone.
SKIP_SUBTYPES = {("Conv", "Raw"), ("Conv", "Wav")}

# The volume the frontend evaluates these at. Below the Loudness reference
# level, otherwise Loudness clamps its boosts to zero and its parameter
# arithmetic never runs.
VOLUME = -45.0


def build_cases():
    """One (id, filter type, parameters) per schema variant."""
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
            cases.append((f"{ftype}-{subtype}-{vname}", ftype, params))

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


def wrap_in_config(filterconf):
    return {
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


def build_variants():
    """
    Every variant the validator accepts, as written and again after validation
    has filled in the schema defaults. The second form is what the GUI often
    holds, and it is where optional keys appear as explicit nulls.
    """
    variants = []
    for case_id, ftype, params in build_cases():
        filterconf = {"type": ftype, "parameters": params}
        validator = CamillaValidator()
        validator.validate_config(copy.deepcopy(wrap_in_config(filterconf)))
        errors = [e for e in validator.get_errors() if e[2] == "error"]
        if errors:
            message = errors[0][1]
            if not EXPECTED_REJECTION.search(message):
                raise AssertionError(
                    f"validator unexpectedly rejects {case_id}: {message}"
                )
            continue
        variants.append({"id": case_id, "filter": filterconf})
        variants.append(
            {
                "id": f"{case_id}-defaults",
                "filter": validator.get_config()["filters"]["testfilter"],
            }
        )
    return {
        "generated_by": "camillagui-backend/tools/dump_filter_variants.py",
        "volume": VOLUME,
        "variants": variants,
    }


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    fixture = build_variants()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"wrote {len(fixture['variants'])} variants to {target}")
