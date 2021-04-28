from os.path import splitext

from backend.filemanagement import is_path_in_folder
from backend.filterdefaults.wavedefaults import defaults_for_wav_file

# TODO wav support
def defaults_for_filter(file_path, coeff_dir):
    if not is_path_in_folder(file_path, coeff_dir):
        return {"errors": ["Filter file is not in coeff_dir."]}
    extension = splitext(file_path)[1]
    if extension == ".wav":
        return {
            "type": "Wav"
        }
    elif extension in [".raw", ".pcm", ".dat"]:
        return {
            "type": "Raw",
            "skip_bytes": 0,
            "read_bytes": 0,
        }
    elif extension == ".dbl":
        return {
            "type": "Raw",
            "format": "FLOAT64LE",
            "skip_bytes": 0,
            "read_bytes": 0,
        }
    else:
        return {}