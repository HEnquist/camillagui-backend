import struct
from os.path import splitext

from filemanagement import is_path_in_folder

sample_types = {1: "int", 3: "float"}


def analyze_chunk(type, start, length, file, wav_info):
    if type == "fmt ":
        data = file.read(length)
        sample_type = sample_types[struct.unpack('<H', data[0:2])[0]]
        wav_info['NumChannels'] = struct.unpack('<H', data[2:4])[0]
        wav_info['SampleRate'] = struct.unpack('<L', data[4:8])[0]
        wav_info['ByteRate'] = struct.unpack('<L', data[8:12])[0]
        wav_info['BytesPerFrame'] = struct.unpack('<H', data[12:14])[0]
        wav_info['BitsPerSample'] = struct.unpack('<H', data[14:16])[0]
        bytes_per_sample = wav_info['BytesPerFrame']/wav_info['NumChannels']
        sample_format = None
        if sample_type == "int":
            if wav_info['BitsPerSample'] == 16:
                sample_format = "S16LE"
            elif wav_info['BitsPerSample'] == 24 and bytes_per_sample == 3:
                sample_format = "S24LE3"
            elif wav_info['BitsPerSample'] == 24 and bytes_per_sample == 4:
                sample_format = "S24LE"
            elif wav_info['BitsPerSample'] == 32:
                sample_format = "S32LE"
        elif sample_type == "float":
            if wav_info['BitsPerSample'] == 32:
                sample_format = "FLOAT32LE"
            elif wav_info['BitsPerSample'] == 64:
                sample_format = "FLOAT64LE"
        wav_info['SampleFormat'] = sample_format
    elif type == "data":
        wav_info['DataStart'] = start
        wav_info['DataLength'] = length


def read_wav_header(filename):
    """
    Reads the wav header to extract sample format, number of channels, and location of the audio data in the file
    """
    with open(filename, 'rb') as file_in:
        # Read fixed header
        buf_header = file_in.read(12)
        # Verify that the correct identifiers are present
        if (buf_header[0:4] != b"RIFF") or (buf_header[8:12] != b"WAVE"):
            raise RuntimeError("Input file is not a standard WAV file")
        # Get file length
        file_in.seek(0, 2) # Seek to end of file
        input_filesize = file_in.tell()
        next_chunk_location = 12 # skip the fixed header
        wav_info = {}
        while True:
            file_in.seek(next_chunk_location)
            buf_header = file_in.read(8)
            chunk_type = buf_header[0:4].decode("utf-8")
            chunk_length = struct.unpack('<L', buf_header[4:8])[0]
            analyze_chunk(chunk_type, next_chunk_location, chunk_length, file_in, wav_info)
            next_chunk_location += (8 + chunk_length)
            if next_chunk_location >= input_filesize:
                break
        file_in.close()
        return wav_info


def defaults_for_filter(file_path, coeff_dir):
    if not is_path_in_folder(file_path, coeff_dir):
        return {"errors": ["Filter file is not in coeff_dir."]}
    extension = splitext(file_path)[1]
    if extension == ".wav":
        return defaults_for_wav_file(file_path)
    elif extension in [".raw", ".pcm", ".dat"]:
        return {
            "skip_bytes": 0,
            "read_bytes": 0,
        }
    elif extension == ".dbl":
        return {
            "format": "FLOAT64LE",
            "skip_bytes": 0,
            "read_bytes": 0,
        }
    else:
        return {}


def defaults_for_wav_file(file_path):
    try:
        header = read_wav_header(file_path)
    except (KeyError, RuntimeError):
        return {"errors": ["Cannot read file."]}
    errors = []
    sample_format = header["SampleFormat"]
    if not sample_format:
        errors.append("Unknown sample format.")
    channel_count = header["NumChannels"]
    if channel_count != 1:
        errors.append(
            "Only single channel WAV files are supported, but {} channels were found.".format(channel_count)
        )
    defaults = {
        "skip_bytes": header["DataStart"],
        "read_bytes": header["DataLength"],
        "errors": errors
    }
    if sample_format:
        defaults["format"] = sample_format
    return defaults