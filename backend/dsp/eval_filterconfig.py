import math
import cmath

import numpy as np
from .filters import (
    BaseFilter,
    Biquad,
    BiquadCombo,
    Conv,
    Delay,
    DiffEq,
    Gain,
    Loudness,
    calc_groupdelay,
)


def logspace(minval, maxval, npoints):
    logmin = math.log10(minval)
    logmax = math.log10(maxval)
    perstep = (logmax - logmin) / npoints
    values = [10.0 ** (logmin + n * perstep) for n in range(npoints)]
    return values


# Filter types that pass audio through unchanged as far as a frequency
# response plot is concerned. They still have to be built, so that a step
# containing one plots the rest of the step instead of failing.
FLAT_FILTER_TYPES = ("Volume", "Dither", "Clipper", "LookaheadLimiter")


def _build_filter(filterconf, samplerate, volume=0.0):
    """
    Build the evaluator for one filter config entry.

    Raises ValueError for a type this module does not know, so that an
    unplottable filter is reported rather than silently left out of the
    result.
    """
    ftype = filterconf["type"]
    params = filterconf.get("parameters")
    if ftype == "Biquad":
        return Biquad(params, samplerate)
    if ftype == "BiquadCombo":
        return BiquadCombo(params, samplerate)
    if ftype == "DiffEq":
        return DiffEq(params, samplerate)
    if ftype == "Conv":
        return Conv(params, samplerate)
    if ftype == "Delay":
        return Delay(params, samplerate)
    if ftype == "Gain":
        return Gain(params)
    if ftype == "Loudness":
        return Loudness(params, samplerate, volume)
    if ftype in FLAT_FILTER_TYPES:
        return BaseFilter()
    raise ValueError(f"Unknown filter type {ftype}")


def _as_lists(result):
    """
    Convert the numpy arrays in a result to plain lists.

    The evaluation is vectorised, but these results are serialised straight to
    JSON by the web layer, which cannot encode numpy types.
    """
    return {
        key: value.tolist() if isinstance(value, np.ndarray) else value
        for key, value in result.items()
    }


def eval_filter(filterconf, name=None, samplerate=44100, npoints=1000, volume=0.0):
    fvect = logspace(1.0, samplerate * 0.95 / 2.0, npoints)
    if name is None:
        name = "unnamed {}".format(filterconf["type"])
    result = {"name": name, "samplerate": samplerate, "f": fvect}
    currfilt = _build_filter(filterconf, samplerate, volume)

    if filterconf["type"] == "Conv":
        # Convolution is the one type with an impulse response to return,
        # and its bulk delay is removed so the phase plot stays readable.
        _fplot, magn, phase = currfilt.gain_and_phase(fvect, remove_delay=True)
        time, impulse = currfilt.get_impulse()
        result["time"] = time
        result["impulse"] = impulse
    else:
        _fplot, magn, phase = currfilt.gain_and_phase(fvect)
    result["magnitude"] = magn
    result["phase"] = phase

    f_grp, groupdelay = calc_groupdelay(result["f"], result["phase"])
    result["f_groupdelay"] = f_grp
    result["groupdelay"] = groupdelay
    return _as_lists(result)


def eval_filterstep(
    conf, pipelineindex, name="filterstep", npoints=1000, overrides=None, volume=0.0
):
    samplerate = conf["devices"]["samplerate"]
    if (
        overrides is not None
        and overrides.get("samplerate") is not None
        and conf["devices"].get("resampler") is None
    ):
        samplerate = overrides["samplerate"]
    fvect = logspace(10.0, samplerate * 0.95 / 2.0, npoints)
    pipelinestep = conf["pipeline"][pipelineindex]
    totcgain = np.ones(npoints, dtype=complex)
    for filt in pipelinestep["names"]:
        filterconf = conf["filters"][filt]
        currfilt = _build_filter(filterconf, samplerate, volume)
        _, cgainstep = currfilt.complex_gain(fvect)
        totcgain = totcgain * cgainstep
    gain = 20.0 * np.log10(np.abs(totcgain) + 1.0e-15)
    phase = np.degrees(np.angle(totcgain))
    f_grp, groupdelay = calc_groupdelay(fvect, phase)
    result = {
        "name": name,
        "samplerate": samplerate,
        "f": fvect,
        "magnitude": gain,
        "phase": phase,
        "f_groupdelay": f_grp,
        "groupdelay": groupdelay,
    }
    return _as_lists(result)
