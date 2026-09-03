import re
from os.path import basename, splitext

FORMAT_MAP = {
    ".txt": "TEXT",
    ".csv": "TEXT",
    ".tsv": "TEXT",
    ".dbl": "F64_LE",
    ".raw": "S32_LE",
    ".pcm": "S32_LE",
    ".dat": "S32_LE",
    ".sam": "S32_LE",
    ".f32": "F32_LE",
    ".f64": "F64_LE",
    ".i32": "S32_LE",
    ".i24": "S24_3_LE",
    ".i16": "S16_LE",
}


def defaults_for_filter(file_path):
    """
    Make suitable filter parameters based of coeff file ending.
    """
    extension = splitext(file_path)[1].lower()
    if extension == ".wav":
        return {"type": "Wav"}
    if extension in FORMAT_MAP:
        return {
            "type": "Raw",
            "format": FORMAT_MAP[extension],
            "skip_bytes_lines": 0,
            "read_bytes_lines": 0,
        }
    return {}


def filter_plot_options(filter_file_names, filename):
    """
    Get the different available options for samplerate and channels for a set of coeffient files.
    """
    filename_pattern = pattern_from_filter_file_name(filename)
    options = []
    for file in filter_file_names:
        match = filename_pattern.match(file)
        if match:
            option = {"name": file}
            groups = match.groupdict()
            if "samplerate" in groups:
                option["samplerate"] = int(groups["samplerate"])
            if "channels" in groups:
                option["channels"] = int(groups["channels"])
            options.append(option)
    return options


def pattern_from_filter_file_name(path):
    """
    Regex patterns for matching samplerate and channels tokens in filename.
    """
    filename = re.escape(basename(path))
    pattern = filename.replace(r"\$samplerate\$", "(?P<samplerate>\\d*)").replace(
        r"\$channels\$", "(?P<channels>\\d*)"
    )
    return re.compile(pattern)
