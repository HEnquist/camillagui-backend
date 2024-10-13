# v1->v2 introduces the default volume control, remove old volume filters
def _remove_volume_filters(config):
    """
    Remove any Volume filter without a "fader" parameter
    """
    if "filters" in config and isinstance(config["filters"], dict):
        volume_names = []
        for name, params in list(config["filters"].items()):
            if params["type"] == "Volume" and "fader" not in params["parameters"]:
                volume_names.append(name)
                del config["filters"][name]

        if "pipeline" in config and isinstance(config["pipeline"], list):
            for step in list(config["pipeline"]):
                if step["type"] == "Filter":
                    step["names"] = [
                        name for name in step["names"] if name not in volume_names
                    ]
                    if len(step["names"]) == 0:
                        config["pipeline"].remove(step)

# v1->v2 removes "ramp_time" from loudness filters
def _modify_loundness_filters(config):
    """
    Modify Loudness filters
    """
    if "filters" in config and isinstance(config["filters"], dict):
        for name, params in config["filters"].items():
            if params["type"] == "Loudness":
                if "ramp_time" in params["parameters"]:
                    del params["parameters"]["ramp_time"]
                params["parameters"]["fader"] = "Main"
                params["parameters"]["attenuate_mid"] = False


# v1->v2 changes the resampler config
def _modify_resampler(config):
    """
    Update the resampler config
    """
    if "enable_resampling" in config["devices"]:
        if config["devices"]["enable_resampling"]:
            # TODO map the easy presets, skip the free?
            if config["devices"]["resampler_type"] == "Synchronous":
                config["devices"]["resampler"] = {"type": "Synchronous"}
            elif config["devices"]["resampler_type"] == "FastAsync":
                config["devices"]["resampler"] = {
                    "type": "AsyncSinc",
                    "profile": "Fast",
                }
            elif config["devices"]["resampler_type"] == "BalancedAsync":
                config["devices"]["resampler"] = {
                    "type": "AsyncSinc",
                    "profile": "Balanced",
                }
            elif config["devices"]["resampler_type"] == "AccurateAsync":
                config["devices"]["resampler"] = {
                    "type": "AsyncSinc",
                    "profile": "Accurate",
                }
            elif isinstance(config["devices"]["resampler_type"], dict):
                old_resampler = config["devices"]["resampler_type"]
                if "FreeAsync" in old_resampler:
                    params = old_resampler["FreeAsync"]
                    new_resampler = {
                        "type": "AsyncSinc",
                        "sinc_len": params["sinc_len"],
                        "oversampling_factor": params["oversampling_ratio"],
                        "interpolation": params["interpolation"],
                        "window": params["window"],
                        "f_cutoff": params["f_cutoff"],
                    }
                    config["devices"]["resampler"] = new_resampler
        else:
            config["devices"]["resampler"] = None
        del config["devices"]["enable_resampling"]
    if "resampler_type" in config["devices"]:
        del config["devices"]["resampler_type"]


def _modify_devices(config):
    """
    Update the options in the devices section
    """
    # New logic for setting sample format
    if "devices" in config:
        if "capture" in config["devices"]:
            dev = config["devices"]["capture"]
            _modify_coreaudio_device(dev)
        if "playback" in config["devices"]:
            dev = config["devices"]["playback"]
            _modify_coreaudio_device(dev)
            _modify_file_playback_device(dev)

        # Resampler
        _modify_resampler(config)

# v1->v2 removes the "change_format" and makes "format" optional
def _modify_coreaudio_device(dev):
    if dev["type"] == "CoreAudio":
        if "change_format" in dev:
            if not dev["change_format"]:
                dev["format"] = None
            del dev["change_format"]
        else:
            dev["format"] = None

# vx-vx changes some of the file playback types
def _modify_file_playback_device(dev):
    if dev["type"] == "File":
        dev["type"] = "RawFile"

# v1->v2 changes some names for dither filters
def _modify_dither(config):
    """
    Update Dither filters, some names have changed.
    Uniform -> Flat
    Simple -> Highpass
    """
    if "filters" in config and isinstance(config["filters"], dict):
        for _name, params in config["filters"].items():
            if params["type"] == "Dither":
                if params["parameters"]["type"] == "Uniform":
                    params["parameters"]["type"] = "Flat"
                elif params["parameters"]["type"] == "Simple":
                    params["parameters"]["type"] = "Highpass"


def _fix_rew_pipeline(config):
    if "pipeline" in config:
        pipeline = config["pipeline"]
        if isinstance(pipeline, dict) and "names" in pipeline and "type" in pipeline:
            # This config was exported from REW.
            # The `pipeline` property consists of a single step instead of a list of steps.
            # Convert `pipeline` to a list of steps, and add the missing `channels` attribute,
            # but check before in case a new version of REW adds the channel(s).
            if "channel" not in pipeline and "channels" not in pipeline:
                pipeline["channels"] = None
            config["pipeline"] = [pipeline]


# v2->v3 changes scalar "channel" to array "channels"
def _modify_pipeline_filter_steps(config):
    if "pipeline" in config and isinstance(config["pipeline"], list):
        for step in config["pipeline"]:
            if step["type"] == "Filter":
                if "channel" in step:
                    step["channels"] = [step["channel"]]
                    del step["channel"]


def migrate_legacy_config(config):
    """
    Modifies an older config file to the latest format.
    The modifications are done in-place.
    """
    _fix_rew_pipeline(config)
    _remove_volume_filters(config)
    _modify_loundness_filters(config)
    _modify_dither(config)
    _modify_devices(config)
    _modify_pipeline_filter_steps(config)


def _look_for_v1_volume(config):
    if "filters" in config and isinstance(config["filters"], dict):
        for name, params in list(config["filters"].items()):
            if params["type"] == "Volume" and "fader" not in params["parameters"]:
                return True
    return False

def _look_for_v1_loudness(config):
    if "filters" in config and isinstance(config["filters"], dict):
        for name, params in config["filters"].items():
            if params["type"] == "Loudness" and "ramp_time" in params["parameters"]:
                return True
    return False

def _look_for_v1_resampler(config):
    return "devices" in config and "enable_resampling" in config["devices"]

def _look_for_v1_devices(config):
    if "devices" in config:
        for direction in ("capture", "playback"):
            if direction in config["devices"] and "type" in config["devices"][direction]:
                if config["devices"][direction]["type"] == "CoreAudio" and "change_format" in config["devices"][direction]:
                    return True
    return False

def _look_for_v2_devices(config):
    return "devices" in config and "capture" in config["devices"] and config["devices"]["capture"]["type"] == "File"

def _look_for_v1_dither(config):
    if "filters" in config and isinstance(config["filters"], dict):
        for _name, params in config["filters"].items():
            if params["type"] == "Dither":
                if params["parameters"]["type"] in ("Uniform", "Simple"):
                    return True
    return False

def _look_for_v2_pipeline(config):
    if "pipeline" in config and isinstance(config["pipeline"], list):
        for step in config["pipeline"]:
            if step["type"] == "Filter":
                if "channel" in step:
                    return True
    return False

def identify_version(config):
    if _look_for_v1_volume(config):
        return 1
    if _look_for_v1_loudness(config):
        return 1
    if _look_for_v1_resampler(config):
        return 1
    if _look_for_v1_devices(config):
        return 1
    if _look_for_v1_dither(config):
        return 1
    if _look_for_v2_pipeline(config):
        return 2
    if _look_for_v2_devices(config):
        return 2
    return 3
