import cmath
import math

import numpy as np

from .audiofileread import read_coeffs
from .defaults import (
    GAIN_SCALE,
    GRAPHIC_EQ_FREQ_MAX,
    GRAPHIC_EQ_FREQ_MIN,
    LOUDNESS_HIGH_BOOST,
    LOUDNESS_HIGH_FREQ,
    LOUDNESS_HIGH_Q,
    LOUDNESS_LOW_BOOST,
    LOUDNESS_LOW_FREQ,
    LOUDNESS_LOW_Q,
    NPOINT_PEQ_MIN_GAIN,
)


def unwrap_phase(values, threshold=150.0):
    """
    Unwrap a phase curve given in degrees.

    Unlike numpy.unwrap, this predicts each value from the previous one plus
    the last known slope, and measures the jump against that prediction. That
    lets it follow a phase that advances by more than 180 degrees per point,
    as a filter with a large delay does, as long as the slope changes
    gradually. numpy.unwrap is limited to 180 degrees per point by
    construction, so it is not a replacement.

    The threshold bounds the prediction error, not the raw step. On smoothly
    varying phase its exact value makes no difference. The only filter it
    affects is a Notch, whose zero sits on the unit circle: the phase step
    across the notch lands just under 180 degrees on a discrete frequency
    grid, so a threshold of 180 would sit right on the boundary of a genuine
    180 degree flip. Group delay is singular at the zero either way, and 150
    is what keeps the resulting spike positive rather than negative.
    """
    offset = 0
    prevdiff = 0.0
    unwrapped = [0.0] * len(values)
    if len(values) > 0:
        unwrapped[0] = values[0]
        for n in range(1, len(values)):
            guess = values[n - 1] + prevdiff
            diff = values[n] - guess
            if diff > threshold:
                offset -= 1
                jumped = True
            elif diff < -threshold:
                offset += 1
                jumped = True
            else:
                jumped = False
            unwrapped[n] = values[n] + 2 * 180.0 * offset
            if not jumped:
                prevdiff = unwrapped[n] - unwrapped[n - 1]
    return unwrapped


def calc_groupdelay(freq, phase):
    if len(freq) < 2:
        return [], []
    freq = np.asarray(freq, dtype=float)
    phase = np.asarray(unwrap_phase(phase), dtype=float)
    dw = np.diff(freq) * 2 * math.pi
    freq_new = (freq[:-1] + freq[1:]) / 2.0
    dp = np.radians(np.diff(phase))
    groupdelay = -1000.0 * dp / dw
    return freq_new, groupdelay


class BaseFilter(object):
    def __init__(self):
        pass

    def complex_gain(self, f, remove_delay=False):
        A = np.ones(len(f), dtype=complex)
        return f, A

    def gain_and_phase(self, f, remove_delay=False):
        _f, Avec = self.complex_gain(f, remove_delay=remove_delay)
        gain = 20 * np.log10(np.abs(Avec) + 1.0e-15)
        phase = np.degrees(np.angle(Avec))
        return f, gain, phase

    def is_stable(self):
        return True


class Conv(object):

    def __init__(self, conf, fs):
        if not conf:
            conf = {"values": [1.0]}
        if "filename" in conf:
            values = read_coeffs(conf)
        elif conf.get("type") == "Dummy":
            values = [1.0] + [0.0] * (int(conf["length"]) - 1)
        else:
            values = conf["values"]
        self.impulse = np.asarray(values, dtype=float)
        self.fs = fs

    def find_peak(self):
        # max() over (magnitude, index) picks the last index on a tie, so
        # search the reversed array to keep that behaviour.
        magnitudes = np.abs(self.impulse)
        return len(magnitudes) - 1 - int(np.argmax(magnitudes[::-1]))

    def complex_gain(self, f, remove_delay=False):
        impulselen = len(self.impulse)
        npoints = 2 ** (math.ceil(math.log2(impulselen)))
        if npoints < 1024:
            npoints = 1024
        impfft = np.fft.fft(self.impulse, n=npoints)
        half = int(npoints / 2)
        f_fft = self.fs * np.arange(half) / npoints
        cut = impfft[0:half]
        if remove_delay:
            maxidx = self.find_peak()
            cut = cut * np.exp(
                1j * 1.0 / (npoints / 2) * math.pi * np.arange(half) * maxidx
            )
        if f is not None:
            interpolated = self.interpolate_polar(cut, f_fft, f)
            return f, interpolated
        return f_fft, cut

    def interpolate(self, y, xold, xnew):
        y = np.asarray(y)
        idx = len(y) * np.asarray(xnew, dtype=float) / xold[-1]
        i1 = np.floor(idx).astype(int)
        fract = idx - i1
        i1 = np.minimum(i1, len(y) - 1)
        i2 = np.minimum(i1 + 1, len(y) - 1)
        return (1 - fract) * y[i1] + fract * y[i2]

    def interpolate_polar(self, y, xold, xnew):
        y_magn = np.abs(y)
        y_ang = np.degrees(np.angle(y))
        # the phase has to be unwrapped on the dense FFT grid before it can be
        # interpolated, otherwise the wraps land between the sample points
        y_ang = np.radians(unwrap_phase(y_ang, threshold=270.0))
        y_magn_interp = self.interpolate(y_magn, xold, xnew)
        y_ang_interp = self.interpolate(y_ang, xold, xnew)
        return y_magn_interp * np.exp(1j * y_ang_interp)

    def gain_and_phase(self, f, remove_delay=False):
        f_fft, Avec = self.complex_gain(None, remove_delay=remove_delay)
        interpolated = self.interpolate_polar(Avec, f_fft, f)
        gain = 20.0 * np.log10(np.abs(interpolated) + 1.0e-15)
        phase = np.degrees(np.angle(interpolated))
        return f, gain, phase

    def get_impulse(self):
        t = np.arange(len(self.impulse)) / self.fs
        return t, self.impulse


def diffeq_is_stable(a):
    """
    True if the 'a' coefficients of a DiffEq give a stable filter, meaning every
    pole is strictly inside the unit circle.

    CamillaDSP uses the Schur-Cohn step-down test to avoid root finding
    (`poles_inside_unit_circle` in src/filters/diffeq.rs). numpy has no such
    routine, but `np.roots` computes the poles directly and gives the same
    verdict: checked against a port of the Schur-Cohn test over 32000 random
    polynomials up to order 8, including deliberately marginal ones, with no
    disagreement. The polynomials here are tiny, so root finding costs nothing.

    An empty or absent list means the CamillaDSP default of a single unity
    coefficient, which is a stable FIR filter. A leading zero is rejected by the
    caller, since it would silently lower the order that `np.roots` sees.
    """
    # len(), not a truth test, so a numpy array works as well as a list
    if a is None or len(a) == 0:
        return True
    roots = np.roots(a)
    return len(roots) == 0 or bool(np.max(np.abs(roots)) < 1.0)


class DiffEq(BaseFilter):
    def __init__(self, conf, fs):
        self.fs = fs
        self.a = conf.get("a") or [1.0]
        self.b = conf.get("b") or [1.0]

    def complex_gain(self, freq, remove_delay=False):
        zvec = np.exp(1j * 2 * math.pi * np.asarray(freq, dtype=float) / self.fs)
        A1 = np.zeros(len(freq), dtype=complex)
        for n, bn in enumerate(self.b):
            A1 = A1 + bn * zvec ** (-n)
        A2 = np.zeros(len(freq), dtype=complex)
        for n, an in enumerate(self.a):
            A2 = A2 + an * zvec ** (-n)
        A = A1 / A2
        return freq, A

    def is_stable(self):
        return diffeq_is_stable(self.a)


class Delay(BaseFilter):
    def __init__(self, conf, fs):
        self.fs = fs
        unit = conf.get("unit", "ms")
        if unit is None:
            unit = "ms"
        if unit == "ms":
            self.delay_samples = conf["delay"] / 1000.0 * fs
        elif unit == "us":
            self.delay_samples = conf["delay"] / 1000000.0 * fs
        elif unit == "mm":
            self.delay_samples = conf["delay"] / 1000.0 * fs / 343.0
        elif unit == "samples":
            self.delay_samples = conf["delay"]
        else:
            raise RuntimeError(f"Unknown unit {unit}")

        self.subsample = conf.get("subsample", False) == True
        if self.delay_samples < 0.1:
            self.subsample = False
        if self.subsample:
            self.delay_full_samples = math.floor(self.delay_samples)
            self.fraction = self.delay_samples - self.delay_full_samples
            if self.delay_samples < 1.1:
                self.delay_full_samples = 0
                self.fraction = self.delay_samples
                self.a1 = (1.0 - self.fraction) / (1.0 + self.fraction)
                self.a2 = 0.0
                self.b0 = (1.0 - self.fraction) / (1.0 + self.fraction)
                self.b1 = 1.0
                self.b2 = 0.0
            else:
                self.delay_full_samples -= 1.0
                self.fraction += 1.0
                if self.fraction < 1.1:
                    self.delay_full_samples -= 1.0
                    self.fraction += 1.0
                coeff1 = 2.0 * (2.0 - self.fraction) / (1.0 + self.fraction)
                coeff2 = (
                    (2.0 - self.fraction)
                    / (2.0 + self.fraction)
                    * (1.0 - self.fraction)
                    / (1.0 + self.fraction)
                )
                self.a1 = coeff1
                self.a2 = coeff2
                self.b0 = coeff2
                self.b1 = coeff1
                self.b2 = 1.0
        else:
            self.delay_full_samples = round(self.delay_samples)

    def complex_gain(self, freq, remove_delay=False):
        freqvec = np.asarray(freq, dtype=float)
        zvec = np.exp(1j * 2 * math.pi * freqvec / self.fs)
        if self.subsample:
            A = (self.b0 + self.b1 * zvec ** (-1) + self.b2 * zvec ** (-2)) / (
                1.0 + self.a1 * zvec ** (-1) + self.a2 * zvec ** (-2)
            )
        else:
            A = np.ones(len(freqvec), dtype=complex)
        if not remove_delay:
            delay_s = self.delay_full_samples / self.fs
            A = A * np.exp(-1j * 2.0 * math.pi * freqvec * delay_s)
        return freq, A

    def is_stable(self):
        # TODO
        return None


class Gain(BaseFilter):
    def __init__(self, conf):
        self.gain = conf["gain"]
        self.inverted = conf.get("inverted") == True
        self.scale = conf.get("scale")
        if self.scale is None:
            self.scale = GAIN_SCALE

    def complex_gain(self, f, remove_delay=False):
        sign = -1.0 if self.inverted else 1.0
        if self.scale == "dB":
            gain = 10.0 ** (self.gain / 20.0) * sign
        else:
            gain = self.gain * sign
        A = np.full(len(f), gain, dtype=complex)
        return f, A


class BiquadCombo(BaseFilter):
    def Butterw_q(self, order):
        odd = order % 2 > 0
        n_so = math.floor(order / 2.0)
        qvalues = []
        for n in range(0, n_so):
            q = 1 / (2.0 * math.sin((math.pi / order) * (n + 1 / 2)))
            qvalues.append(q)
        if odd:
            qvalues.append(-1.0)
        return qvalues

    def __init__(self, conf, fs):
        self.ftype = conf["type"]
        if self.ftype in [
            "LinkwitzRileyHighpass",
            "LinkwitzRileyLowpass",
            "ButterworthHighpass",
            "ButterworthHighpass",
            "ButterworthLowpass",
        ]:
            self.order = conf["order"]
            self.freq = conf["freq"]
            self.fs = fs
            if self.ftype == "LinkwitzRileyHighpass":
                # qvalues = self.LRtable[self.order]
                q_temp = self.Butterw_q(self.order / 2)
                if (self.order / 2) % 2 > 0:
                    q_temp = q_temp[0:-1]
                    qvalues = q_temp + q_temp + [0.5]
                else:
                    qvalues = q_temp + q_temp
                type_so = "Highpass"
                type_fo = "HighpassFO"

            elif self.ftype == "LinkwitzRileyLowpass":
                q_temp = self.Butterw_q(self.order / 2)
                if (self.order / 2) % 2 > 0:
                    q_temp = q_temp[0:-1]
                    qvalues = q_temp + q_temp + [0.5]
                else:
                    qvalues = q_temp + q_temp
                type_so = "Lowpass"
                type_fo = "LowpassFO"
            elif self.ftype == "ButterworthHighpass":
                qvalues = self.Butterw_q(self.order)
                type_so = "Highpass"
                type_fo = "HighpassFO"
            elif self.ftype == "ButterworthLowpass":
                qvalues = self.Butterw_q(self.order)
                type_so = "Lowpass"
                type_fo = "LowpassFO"
            self.biquads = []
            for q in qvalues:
                if q >= 0:
                    bqconf = {"freq": self.freq, "q": q, "type": type_so}
                else:
                    bqconf = {"freq": self.freq, "type": type_fo}
                self.biquads.append(Biquad(bqconf, self.fs))
        elif self.ftype == "NPointPeq":
            # The role of a band follows its position: the first is a low shelf,
            # the last a high shelf, and the ones between are peaking filters.
            # A band with no significant gain does nothing, so the DSP leaves it
            # out; skip it here too so the plot matches.
            bands = conf["bands"]
            last = len(bands) - 1
            self.biquads = []
            for n, band in enumerate(bands):
                if abs(band["gain"]) <= NPOINT_PEQ_MIN_GAIN:
                    continue
                if n == 0:
                    bqtype = "Lowshelf"
                elif n == last:
                    bqtype = "Highshelf"
                else:
                    bqtype = "Peaking"
                self.biquads.append(
                    Biquad(
                        {
                            "freq": band["freq"],
                            "q": band["q"],
                            "gain": band["gain"],
                            "type": bqtype,
                        },
                        fs,
                    )
                )
        elif self.ftype == "GraphicEqualizer":
            bands = len(conf["gains"])
            # 'or' on purpose: zero is invalid here (the DSP rejects it)
            # and must fall back to the default rather than reach log2
            f_min = conf.get("freq_min") or GRAPHIC_EQ_FREQ_MIN
            f_max = conf.get("freq_max") or GRAPHIC_EQ_FREQ_MAX
            f_min_log = math.log2(f_min)
            f_max_log = math.log2(f_max)
            self.biquads = []
            bw = (f_max_log - f_min_log) / bands
            for band, gain in enumerate(conf["gains"]):
                if math.fabs(gain) > 0.01:
                    freq_log = f_min_log + (band + 0.5) * bw
                    freq = 2.0**freq_log
                    filt = Biquad(
                        {
                            "freq": freq,
                            "bandwidth": bw,
                            "gain": gain,
                            "type": "Peaking",
                        },
                        fs,
                    )
                    self.biquads.append(filt)
        elif self.ftype == "Tilt":
            gain_low = -conf["gain"] / 2.0
            gain_high = conf["gain"] / 2.0
            lsconf = Biquad(
                {"freq": 110.0, "q": 0.35, "gain": gain_low, "type": "Lowshelf"}, fs
            )
            hsconf = Biquad(
                {"freq": 3500.0, "q": 0.35, "gain": gain_high, "type": "Highshelf"}, fs
            )
            self.biquads = [lsconf, hsconf]

    def is_stable(self):
        # TODO
        return None

    def complex_gain(self, freq, remove_delay=False):
        A = np.ones(len(freq), dtype=complex)
        for bq in self.biquads:
            _f, Atemp = bq.complex_gain(freq)
            A = A * Atemp
        return freq, A


def _or_default(conf, key, default):
    """Read an optional parameter. A missing key and an explicit null both mean
    "not set", so both get CamillaDSP's default."""
    value = conf.get(key)
    return default if value is None else value


class Loudness(BaseFilter):
    def __init__(self, conf, fs, volume):
        rel_vol = volume - conf["reference_level"]
        rel_boost = -rel_vol / 20.0
        if rel_boost > 1.0:
            rel_boost = 1.0
        elif rel_boost < 0.0:
            rel_boost = 0.0
        high_boost = _or_default(conf, "high_boost", LOUDNESS_HIGH_BOOST)
        low_boost = _or_default(conf, "low_boost", LOUDNESS_LOW_BOOST)
        high_boost = rel_boost * high_boost
        low_boost = rel_boost * low_boost
        if conf.get("attenuate_mid"):
            max_gain = max(high_boost, low_boost)
            self.mid_gain = 10.0 ** (-max_gain / 20.0)
        else:
            self.mid_gain = 1.0

        # The shelves take a Q, as in the DSP. The default Q is equivalent to the
        # fixed 12 dB/octave slope used before these parameters existed.
        lsconf = Biquad(
            {
                "freq": _or_default(conf, "low_freq", LOUDNESS_LOW_FREQ),
                "q": _or_default(conf, "low_q", LOUDNESS_LOW_Q),
                "gain": low_boost,
                "type": "Lowshelf",
            },
            fs,
        )
        hsconf = Biquad(
            {
                "freq": _or_default(conf, "high_freq", LOUDNESS_HIGH_FREQ),
                "q": _or_default(conf, "high_q", LOUDNESS_HIGH_Q),
                "gain": high_boost,
                "type": "Highshelf",
            },
            fs,
        )
        self.biquads = [lsconf, hsconf]

    def complex_gain(self, freq, remove_delay=False):
        A = np.full(len(freq), self.mid_gain, dtype=complex)
        for bq in self.biquads:
            _f, Atemp = bq.complex_gain(freq)
            A = A * Atemp
        return freq, A


class Biquad(BaseFilter):
    def __init__(self, conf, fs):
        ftype = conf["type"]
        if ftype == "Free":
            a0 = 1.0
            a1 = conf["a1"]
            a2 = conf["a2"]
            b0 = conf["b0"]
            b1 = conf["b1"]
            b2 = conf["b2"]
        if ftype == "Highpass":
            freq = conf["freq"]
            q = conf["q"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            alpha = sn / (2.0 * q)
            b0 = (1.0 + cs) / 2.0
            b1 = -(1.0 + cs)
            b2 = (1.0 + cs) / 2.0
            a0 = 1.0 + alpha
            a1 = -2.0 * cs
            a2 = 1.0 - alpha
        elif ftype == "Lowpass":
            freq = conf["freq"]
            q = conf["q"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            alpha = sn / (2.0 * q)
            b0 = (1.0 - cs) / 2.0
            b1 = 1.0 - cs
            b2 = (1.0 - cs) / 2.0
            a0 = 1.0 + alpha
            a1 = -2.0 * cs
            a2 = 1.0 - alpha
        elif ftype == "Peaking":
            freq = conf["freq"]
            gain = conf["gain"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            ampl = 10.0 ** (gain / 40.0)
            if "q" in conf:
                q = conf["q"]
                alpha = sn / (2.0 * q)
            else:
                bandwidth = conf["bandwidth"]
                alpha = sn * math.sinh(math.log(2.0) / 2.0 * bandwidth * omega / sn)
            b0 = 1.0 + (alpha * ampl)
            b1 = -2.0 * cs
            b2 = 1.0 - (alpha * ampl)
            a0 = 1.0 + (alpha / ampl)
            a1 = -2.0 * cs
            a2 = 1.0 - (alpha / ampl)
        elif ftype == "HighshelfFO":
            freq = conf["freq"]
            gain = conf["gain"]
            omega = 2.0 * math.pi * freq / fs
            ampl = 10.0 ** (gain / 40.0)
            tn = math.tan(omega / 2)
            b0 = ampl * tn + ampl**2
            b1 = ampl * tn - ampl**2
            b2 = 0.0
            a0 = ampl * tn + 1
            a1 = ampl * tn - 1
            a2 = 0.0
        elif ftype == "Highshelf":
            freq = conf["freq"]
            gain = conf["gain"]
            omega = 2.0 * math.pi * freq / fs
            ampl = 10.0 ** (gain / 40.0)
            sn = math.sin(omega)
            cs = math.cos(omega)
            if "slope" in conf:
                slope = conf["slope"]
                alpha = (
                    sn
                    / 2.0
                    * math.sqrt(
                        (ampl + 1.0 / ampl) * (1.0 / (slope / 12.0) - 1.0) + 2.0
                    )
                )
                beta = 2.0 * math.sqrt(ampl) * alpha
            else:
                q = conf["q"]
                beta = sn * math.sqrt(ampl) / q
            b0 = ampl * ((ampl + 1.0) + (ampl - 1.0) * cs + beta)
            b1 = -2.0 * ampl * ((ampl - 1.0) + (ampl + 1.0) * cs)
            b2 = ampl * ((ampl + 1.0) + (ampl - 1.0) * cs - beta)
            a0 = (ampl + 1.0) - (ampl - 1.0) * cs + beta
            a1 = 2.0 * ((ampl - 1.0) - (ampl + 1.0) * cs)
            a2 = (ampl + 1.0) - (ampl - 1.0) * cs - beta
        elif ftype == "LowshelfFO":
            freq = conf["freq"]
            gain = conf["gain"]
            omega = 2.0 * math.pi * freq / fs
            ampl = 10.0 ** (gain / 40.0)
            tn = math.tan(omega / 2)
            b0 = ampl**2 * tn + ampl
            b1 = ampl**2 * tn - ampl
            b2 = 0.0
            a0 = tn + ampl
            a1 = tn - ampl
            a2 = 0.0
        elif ftype == "Lowshelf":
            freq = conf["freq"]
            gain = conf["gain"]
            omega = 2.0 * math.pi * freq / fs
            ampl = 10.0 ** (gain / 40.0)
            sn = math.sin(omega)
            cs = math.cos(omega)
            if "slope" in conf:
                slope = conf["slope"]
                alpha = (
                    sn
                    / 2.0
                    * math.sqrt(
                        (ampl + 1.0 / ampl) * (1.0 / (slope / 12.0) - 1.0) + 2.0
                    )
                )
                beta = 2.0 * math.sqrt(ampl) * alpha
            else:
                q = conf["q"]
                beta = sn * math.sqrt(ampl) / q

            b0 = ampl * ((ampl + 1.0) - (ampl - 1.0) * cs + beta)
            b1 = 2.0 * ampl * ((ampl - 1.0) - (ampl + 1.0) * cs)
            b2 = ampl * ((ampl + 1.0) - (ampl - 1.0) * cs - beta)
            a0 = (ampl + 1.0) + (ampl - 1.0) * cs + beta
            a1 = -2.0 * ((ampl - 1.0) + (ampl + 1.0) * cs)
            a2 = (ampl + 1.0) + (ampl - 1.0) * cs - beta
        elif ftype == "LowpassFO":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            k = math.tan(omega / 2.0)
            alpha = 1 + k
            a0 = 1.0
            a1 = -((1 - k) / alpha)
            a2 = 0.0
            b0 = k / alpha
            b1 = k / alpha
            b2 = 0
        elif ftype == "HighpassFO":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            k = math.tan(omega / 2.0)
            alpha = 1 + k
            a0 = 1.0
            a1 = -((1 - k) / alpha)
            a2 = 0.0
            b0 = 1.0 / alpha
            b1 = -1.0 / alpha
            b2 = 0
        elif ftype == "Notch":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            if "q" in conf:
                q = conf["q"]
                alpha = sn / (2.0 * q)
            else:
                bandwidth = conf["bandwidth"]
                alpha = sn * math.sinh(math.log(2.0) / 2.0 * bandwidth * omega / sn)
            b0 = 1.0
            b1 = -2.0 * cs
            b2 = 1.0
            a0 = 1.0 + alpha
            a1 = -2.0 * cs
            a2 = 1.0 - alpha
        elif ftype == "GeneralNotch":
            f_p = conf["freq_p"]
            f_z = conf["freq_z"]
            q_p = conf["q_p"]
            normalize_at_dc = conf.get("normalize_at_dc") == True

            # apply pre-warping
            tn_z = math.tan(math.pi * f_z / fs)
            tn_p = math.tan(math.pi * f_p / fs)
            alpha = tn_p / q_p
            tn2_p = tn_p**2
            tn2_z = tn_z**2

            # calculate gain
            if normalize_at_dc:
                gain = tn2_p / tn2_z
            else:
                gain = 1.0

            b0 = gain * (1.0 + tn2_z)
            b1 = -2.0 * gain * (1.0 - tn2_z)
            b2 = gain * (1.0 + tn2_z)
            a0 = 1.0 + alpha + tn2_p
            a1 = -2.0 + 2.0 * tn2_p
            a2 = 1.0 - alpha + tn2_p

        elif ftype == "Bandpass":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            if "q" in conf:
                q = conf["q"]
                alpha = sn / (2.0 * q)
            else:
                bandwidth = conf["bandwidth"]
                alpha = sn * math.sinh(math.log(2.0) / 2.0 * bandwidth * omega / sn)
            b0 = alpha
            b1 = 0.0
            b2 = -alpha
            a0 = 1.0 + alpha
            a1 = -2.0 * cs
            a2 = 1.0 - alpha
        elif ftype == "Allpass":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            sn = math.sin(omega)
            cs = math.cos(omega)
            if "q" in conf:
                q = conf["q"]
                alpha = sn / (2.0 * q)
            else:
                bandwidth = conf["bandwidth"]
                alpha = sn * math.sinh(math.log(2.0) / 2.0 * bandwidth * omega / sn)
            b0 = 1.0 - alpha
            b1 = -2.0 * cs
            b2 = 1.0 + alpha
            a0 = 1.0 + alpha
            a1 = -2.0 * cs
            a2 = 1.0 - alpha
        elif ftype == "AllpassFO":
            freq = conf["freq"]
            omega = 2.0 * math.pi * freq / fs
            tn = math.tan(omega / 2.0)
            alpha = (tn + 1.0) / (tn - 1.0)
            b0 = 1.0
            b1 = alpha
            b2 = 0.0
            a0 = alpha
            a1 = 1.0
            a2 = 0.0
        elif ftype == "LinkwitzTransform":
            f0 = conf["freq_act"]
            q0 = conf["q_act"]
            qt = conf["q_target"]
            ft = conf["freq_target"]

            d0i = (2.0 * math.pi * f0) ** 2
            d1i = (2.0 * math.pi * f0) / q0
            c0i = (2.0 * math.pi * ft) ** 2
            c1i = (2.0 * math.pi * ft) / qt
            fc = (ft + f0) / 2.0

            gn = 2 * math.pi * fc / math.tan(math.pi * fc / fs)
            cci = c0i + gn * c1i + gn**2

            b0 = (d0i + gn * d1i + gn**2) / cci
            b1 = 2 * (d0i - gn**2) / cci
            b2 = (d0i - gn * d1i + gn**2) / cci
            a0 = 1.0
            a1 = 2.0 * (c0i - gn**2) / cci
            a2 = (c0i - gn * c1i + gn**2) / cci

        self.fs = fs
        self.a1 = a1 / a0
        self.a2 = a2 / a0
        self.b0 = b0 / a0
        self.b1 = b1 / a0
        self.b2 = b2 / a0

    def complex_gain(self, freq, remove_delay=False):
        zvec = np.exp(1j * 2 * math.pi * np.asarray(freq, dtype=float) / self.fs)
        A = (self.b0 + self.b1 * zvec ** (-1) + self.b2 * zvec ** (-2)) / (
            1.0 + self.a1 * zvec ** (-1) + self.a2 * zvec ** (-2)
        )
        return freq, A

    def is_stable(self):
        return abs(self.a2) < 1.0 and abs(self.a1) < (self.a2 + 1.0)
