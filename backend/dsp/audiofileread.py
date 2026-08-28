import struct
import csv
import itertools

import numpy as np

NUMBERFORMATS = {
    1: "int",
    3: "float",
    0xFFFE: "extended",
}

SUBFORMAT_FLOAT = (3, 0, 16, 128, 0, 0, 170, 0, 56, 155, 113)
SUBFORMAT_INT = (1, 0, 16, 128, 0, 0, 170, 0, 56, 155, 113)

TYPES_DIRECT = {
    "F64_LE": "<f8",
    "F32_LE": "<f4",
    "S16_LE": "<i2",
    "S32_LE": "<i4",
}

# Formats numpy has no dtype for. "first" is the offset of the first of the
# three sample bytes within each frame.
TYPES_INDIRECT = {
    "S24_4_RJ_LE": {"first": 0},
    "S24_4_LJ_LE": {"first": 1},
    "S24_3_LE": {"first": 0},
}

SCALEFACTOR = {
    "F64_LE": 1.0,
    "F32_LE": 1.0,
    "S16_LE": (2**15),
    "S24_4_RJ_LE": (2**23),
    "S24_4_LJ_LE": (2**23),
    "S24_3_LE": (2**23),
    "S32_LE": (2**31),
}

BYTESPERSAMPLE = {
    "F64_LE": 8,
    "F32_LE": 4,
    "S16_LE": 2,
    "S24_4_RJ_LE": 4,
    "S24_4_LJ_LE": 4,
    "S24_3_LE": 3,
    "S32_LE": 4,
}


def read_coeffs(conf):
    if conf["type"] == "Raw":
        fname = conf["filename"]
        sampleformat = conf.get("format", "TEXT")
        read_nbr = conf.get("read_bytes_lines", None)
        if read_nbr == 0:
            read_nbr = None
        skip_nbr = conf.get("skip_bytes_lines", 0)
        values = read_raw_coeffs(
            fname, sampleformat, skip_nbr=skip_nbr, read_nbr=read_nbr
        )
        return values
    elif conf["type"] == "Wav":
        channel = conf.get("channel", 0)
        fname = conf["filename"]
        values = read_wav_coeffs(fname, channel)
        return values


def read_raw_coeffs(filename, sampleformat=None, skip_nbr=0, read_nbr=None):
    if read_nbr == 0:
        read_nbr = None
    if sampleformat == "TEXT":
        values = read_text_coeffs(filename, skip_nbr, read_nbr)
    else:
        if sampleformat in TYPES_DIRECT:
            values = read_binary_direct_coeffs(
                filename, sampleformat, skip_nbr, read_nbr
            )
        elif sampleformat in TYPES_INDIRECT:
            values = read_binary_indirect_coeffs(
                filename, sampleformat, skip_nbr, read_nbr
            )
        else:
            raise ValueError(f"Unsupported format {sampleformat}")
    return values


def read_text_coeffs(fname, skip_lines, read_lines):
    if read_lines == 0:
        read_lines = None
    with open(fname) as f:
        rawvalues = itertools.islice(csv.reader(f), skip_lines, read_lines)
        values = [float(row[0]) for row in rawvalues]
    return values


def read_binary_direct_coeffs(fname, sampleformat, skip_bytes, read_bytes):
    """Read samples in a format numpy has a dtype for."""
    dtype = np.dtype(TYPES_DIRECT[sampleformat])
    factor = SCALEFACTOR[sampleformat]
    count = -1 if read_bytes is None else read_bytes // dtype.itemsize
    values = np.fromfile(fname, dtype=dtype, count=count, offset=skip_bytes)
    return values.astype(np.float64) / factor


def read_binary_indirect_coeffs(fname, sampleformat, skip_bytes, read_bytes):
    """
    Read 24-bit samples, which numpy has no dtype for.

    The three bytes of each sample are copied into the top three bytes of a
    little endian int32 and shifted back down, which sign extends them. The
    low byte is zero, so the shift is exact.
    """
    first = TYPES_INDIRECT[sampleformat]["first"]
    width = BYTESPERSAMPLE[sampleformat]
    factor = SCALEFACTOR[sampleformat]
    count = -1 if read_bytes is None else read_bytes
    raw = np.fromfile(fname, dtype=np.uint8, count=count, offset=skip_bytes)
    raw = raw[: len(raw) - len(raw) % width].reshape(-1, width)
    padded = np.zeros((len(raw), 4), dtype=np.uint8)
    padded[:, 1:4] = raw[:, first : first + 3]
    values = padded.view("<i4").ravel() >> 8
    return values.astype(np.float64) / factor


def read_wav_coeffs(fname, channel):
    params = read_wav_header(fname)
    if params is None:
        raise ValueError(f"Invalid or unsupported wav file '{fname}'")
    if channel >= params["channels"]:
        raise ValueError(
            f"Can't read channel {channel} from {fname} which has {params['channels']} channels"
        )
    allvalues = read_raw_coeffs(
        fname,
        sampleformat=params["sampleformat"],
        skip_nbr=params["dataoffset"],
        read_nbr=params["datalength"],
    )
    values = allvalues[channel :: params["channels"]]
    return values


# RF64 puts this in the 32-bit size fields it cannot express
RF64_SENTINEL = 0xFFFFFFFF


def analyze_wav_chunk(type, start, length, file, wav_info):
    """
    Read one RIFF chunk into wav_info.

    Returns the effective length of the chunk, which differs from the given
    one only for an RF64 data chunk, where the real size comes from ds64.
    """
    if type == "fmt ":
        data = file.read(length)
        wav_info["sampleformat"] = NUMBERFORMATS.get(
            struct.unpack("<H", data[0:2])[0], "unknown"
        )
        wav_info["channels"] = struct.unpack("<H", data[2:4])[0]
        wav_info["samplerate"] = struct.unpack("<L", data[4:8])[0]
        wav_info["byterate"] = struct.unpack("<L", data[8:12])[0]
        wav_info["bytesperframe"] = struct.unpack("<H", data[12:14])[0]
        wav_info["bitspersample"] = struct.unpack("<H", data[14:16])[0]
        bytes_per_sample = wav_info["bytesperframe"] / wav_info["channels"]

        # Handle extended fmt chunk
        if wav_info["sampleformat"] == "extended":
            if length != 40:
                print("Invalid extended wav header")
                return
            cb_size = struct.unpack("<H", data[16:18])[0]
            valid_bits_per_sample = struct.unpack("<H", data[18:20])[0]
            if cb_size != 22 or valid_bits_per_sample != wav_info["bitspersample"]:
                print("Invalid extended wav header")
                return length
            _channel_mask = struct.unpack("<L", data[20:24])[0]
            subformat = struct.unpack("<LHHBBBBBBBB", data[24:40])
            if subformat == SUBFORMAT_FLOAT:
                wav_info["sampleformat"] = "float"
            elif subformat == SUBFORMAT_INT:
                wav_info["sampleformat"] = "int"
            else:
                wav_info["sampleformat"] = "unknown"

        if wav_info["sampleformat"] == "int":
            if wav_info["bitspersample"] == 16:
                sfmt = "S16_LE"
            elif wav_info["bitspersample"] == 24 and bytes_per_sample == 3:
                sfmt = "S24_3_LE"
            elif wav_info["bitspersample"] == 24 and bytes_per_sample == 4:
                sfmt = "S24_4_LJ_LE"
            elif wav_info["bitspersample"] == 32:
                sfmt = "S32_LE"
        elif wav_info["sampleformat"] == "float":
            if wav_info["bitspersample"] == 32:
                sfmt = "F32_LE"
            elif wav_info["bitspersample"] == 64:
                sfmt = "F64_LE"
        else:
            sfmt = "unknown"
        wav_info["sampleformat"] = sfmt
    elif type == "ds64":
        # RF64 only. Holds the 64-bit sizes that the RIFF and data headers
        # cannot express: riffSize, dataSize, sampleCount, tableLength.
        data = file.read(length)
        if length >= 16:
            wav_info["_ds64_datalength"] = struct.unpack("<Q", data[8:16])[0]
    elif type == "data":
        wav_info["dataoffset"] = start + 8
        if length == RF64_SENTINEL and wav_info["_ds64_datalength"] is not None:
            length = wav_info["_ds64_datalength"]
        wav_info["datalength"] = length
    return length


def read_wav_header(filename):
    """
    Reads the wav header to extract sample format, number of channels, and location of the audio data in the file
    """
    try:
        with open(filename, "rb") as file_in:
            # Read fixed header
            buf_header = file_in.read(12)
            # Verify that the correct identifiers are present. RF64 is the
            # variant for files larger than 4 GB, which CamillaDSP writes when
            # use_rf64 is set. It is a RIFF file with 64-bit sizes in a ds64
            # chunk, so everything after this point is the same.
            if (buf_header[0:4] not in (b"RIFF", b"RF64")) or (
                buf_header[8:12] != b"WAVE"
            ):
                print("Input file is not a standard WAV file")
                return

            wav_info = {
                "dataoffset": None,
                "datalength": None,
                "sampleformat": None,
                "bitspersample": None,
                "channels": None,
                "byterate": None,
                "samplerate": None,
                "bytesperframe": None,
                # internal, removed before returning
                "_ds64_datalength": None,
            }

            # Get file length
            file_in.seek(0, 2)  # Seek to end of file
            input_filesize = file_in.tell()

            next_chunk_location = 12  # skip the fixed header
            while True:
                file_in.seek(next_chunk_location)
                buf_header = file_in.read(8)
                if len(buf_header) < 8:
                    break
                chunk_type = buf_header[0:4].decode("ascii", errors="replace")
                chunk_length = struct.unpack("<L", buf_header[4:8])[0]
                chunk_length = analyze_wav_chunk(
                    chunk_type, next_chunk_location, chunk_length, file_in, wav_info
                )
                next_chunk_location += 8 + chunk_length
                # RIFF chunks are word aligned, an odd length is padded
                if chunk_length % 2:
                    next_chunk_location += 1
                if next_chunk_location >= input_filesize:
                    break
            del wav_info["_ds64_datalength"]
            if wav_info["datalength"] is not None and wav_info["sampleformat"] not in [
                None,
                "unknown",
            ]:
                return wav_info
    except IOError as err:
        print(
            'Could not open input file: "{}", error: {}'.format(str(filename), str(err))
        )
        return


if __name__ == "__main__":
    import sys

    info = read_wav_header(sys.argv[1])
    if info is not None:
        print("Wav properties:")
        for name, val in info.items():
            print("{} : {}".format(name, val))
    else:
        print("Invalid wav-file")
