def _remove_volume_filters(config):
    """
    Remove any Volume filter
    """
    if "filters" in config:
        volume_names = []
        for name, params in list(config["filters"].items()):
            if params["type"] == "Volume":
                volume_names.append(name)
                del config["filters"][name]

        if "pipeline" in config:
            for step in list(config["pipeline"]):
                if step["type"] == "Filter":
                    step["names"] = [
                        name for name in step["names"] if name not in volume_names
                    ]
                    if len(step["names"]) == 0:
                        config["pipeline"].remove(step)


def _modify_loundness_filters(config):
    """
    Modify Loudness filters
    """
    if "filters" in config:
        for name, params in config["filters"].items():
            if params["type"] == "Loudness":
                del params["parameters"]["ramp_time"]
                params["parameters"]["fader"] = "Main"
                params["parameters"]["attenuate_mid"] = False


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

        # Resampler
        _modify_resampler(config)


def _modify_coreaudio_device(dev):
    if dev["type"] == "CoreAudio":
        if "change_format" in dev:
            if not dev["change_format"]:
                dev["format"] = None
            del dev["change_format"]
        else:
            dev["format"] = None


def _modify_dither(config):
    """
    Update Dither filters, some names have changed.
    Uniform -> Flat
    Simple -> Highpass
    """
    if "filters" in config:
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
            # Convert `pipeline` to a list of steps instead of a single step,
            # and add the missing `channel` attribute.
            if "channel" not in pipeline:
                pipeline["channel"] = 0
            config["pipeline"] = [pipeline]

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
