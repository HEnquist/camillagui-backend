import struct

import pytest

from backend.dsp.audiofileread import read_raw_coeffs, read_wav_header

SAMPLES = b"\x00\x00" * 100


def _fmt_chunk(channels=2, samplerate=48000, bits=16):
    frame = channels * bits // 8
    return b"fmt " + struct.pack("<L", 16) + struct.pack(
        "<HHLLHH", 1, channels, samplerate, samplerate * frame, frame, bits
    )


def _write_riff(path, extra_chunk=b""):
    body = extra_chunk + _fmt_chunk() + b"data" + struct.pack("<L", len(SAMPLES)) + SAMPLES
    path.write_bytes(b"RIFF" + struct.pack("<L", len(body) + 4) + b"WAVE" + body)
    return path


def _write_rf64(path):
    # RF64 puts 0xFFFFFFFF in the 32-bit size fields and the real sizes in ds64
    ds64 = b"ds64" + struct.pack("<L", 28) + struct.pack(
        "<QQQL", 0, len(SAMPLES), len(SAMPLES) // 4, 0
    )
    body = ds64 + _fmt_chunk() + b"data" + struct.pack("<L", 0xFFFFFFFF) + SAMPLES
    path.write_bytes(b"RF64" + struct.pack("<L", 0xFFFFFFFF) + b"WAVE" + body)
    return path


def test_reads_a_plain_riff_wav(tmp_path):
    info = read_wav_header(_write_riff(tmp_path / "plain.wav"))
    assert info["sampleformat"] == "S16_LE"
    assert info["channels"] == 2
    assert info["samplerate"] == 48000
    assert info["datalength"] == len(SAMPLES)


def test_reads_an_rf64_wav(tmp_path):
    """
    CamillaDSP 5.0 writes RF64 when use_rf64 is set, for files past the 4 GB
    limit of plain wav. The magic differs and the data size is a sentinel.
    """
    info = read_wav_header(_write_rf64(tmp_path / "big.wav"))
    assert info is not None, "RF64 file was rejected"
    assert info["sampleformat"] == "S16_LE"
    assert info["channels"] == 2
    # the real length comes from ds64, not from the 0xFFFFFFFF sentinel
    assert info["datalength"] == len(SAMPLES)


def test_wav_header_has_no_internal_keys(tmp_path):
    # the parsed header is returned to the frontend as wav info
    info = read_wav_header(_write_rf64(tmp_path / "big.wav"))
    assert not any(key.startswith("_") for key in info)


def test_odd_length_chunks_are_word_aligned(tmp_path):
    """RIFF pads an odd chunk to an even boundary; missing that desyncs the walk."""
    odd = b"LIST" + struct.pack("<L", 5) + b"INFOx" + b"\x00"
    info = read_wav_header(_write_riff(tmp_path / "odd.wav", extra_chunk=odd))
    assert info is not None, "the chunk walk lost sync on an odd-length chunk"
    assert info["sampleformat"] == "S16_LE"


def test_rejects_a_file_that_is_not_wav(tmp_path):
    path = tmp_path / "nope.wav"
    path.write_bytes(b"NOTAFILE" + b"\x00" * 40)
    assert read_wav_header(path) is None


VALUES = [-0.9 + 1.8 * n / 500 for n in range(501)]


def _write_raw(path, fmt):
    if fmt in ("F64_LE", "F32_LE", "S16_LE", "S32_LE"):
        code, scale = {
            "F64_LE": ("d", 1.0), "F32_LE": ("f", 1.0),
            "S16_LE": ("h", 2**15), "S32_LE": ("i", 2**31),
        }[fmt]
        samples = VALUES if scale == 1.0 else [int(v * scale) for v in VALUES]
        path.write_bytes(struct.pack(f"<{len(samples)}{code}", *samples))
        return path
    # 24 bit, written as the low three bytes of a little endian int32
    packed = [struct.pack("<i", int(v * (2**23 - 1))) for v in VALUES]
    if fmt == "S24_3_LE":
        path.write_bytes(b"".join(sample[:3] for sample in packed))
    elif fmt == "S24_4_RJ_LE":
        path.write_bytes(b"".join(packed))
    else:  # S24_4_LJ_LE
        path.write_bytes(b"".join(b"\x00" + sample[:3] for sample in packed))
    return path


@pytest.mark.parametrize(
    "fmt,tolerance",
    [("F64_LE", 1e-12), ("F32_LE", 1e-7), ("S32_LE", 1e-9),
     ("S16_LE", 1e-4), ("S24_3_LE", 1e-6),
     ("S24_4_RJ_LE", 1e-6), ("S24_4_LJ_LE", 1e-6)],
)
def test_raw_coefficients_round_trip(tmp_path, fmt, tolerance):
    values = read_raw_coeffs(str(_write_raw(tmp_path / f"c_{fmt}.raw", fmt)), fmt)
    assert len(values) == len(VALUES)
    assert max(abs(got - want) for got, want in zip(values, VALUES)) < tolerance


def test_24_bit_samples_sign_extend(tmp_path):
    """
    The three sample bytes are placed in the top of an int32 and shifted back
    down, so a negative sample has to come out negative.
    """
    # exact sample codes, including both extremes of the 24-bit range
    codes = [-(2**23), -1000, -1, 0, 1, 1000, 2**23 - 1]
    expected = [code / 2**23 for code in codes]
    path = tmp_path / "neg.raw"
    path.write_bytes(b"".join(struct.pack("<i", code)[:3] for code in codes))
    values = read_raw_coeffs(str(path), "S24_3_LE")
    assert values == expected
    assert all(value < 0 for value in values[:3])
    assert values[0] == -1.0


def test_skip_and_read_counts_are_still_in_bytes(tmp_path):
    path = _write_raw(tmp_path / "skip.raw", "F32_LE")
    values = read_raw_coeffs(str(path), "F32_LE", skip_nbr=40, read_nbr=80)
    assert len(values) == 20
    assert max(abs(got - want) for got, want in zip(values, VALUES[10:30])) < 1e-6
