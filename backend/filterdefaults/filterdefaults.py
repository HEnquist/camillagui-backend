from os.path import splitext

from backend.filemanagement import is_path_in_folder
from backend.filterdefaults.wavedefaults import defaults_for_wav_file


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