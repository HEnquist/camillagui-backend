def _remove_volume_filters(config):
    """
    Remove any Volume filter
    """
    pass

def _modify_loundness_filters(config):
    """
    Modify Loudness filters
    """
    pass

def _modify_resampler(config):
    """
    Update the resampler config
    """
    if "enable_resampling" in config["devices"]:
        if config["devices"]["enable_resampling"]:
            # TODO map the easy presets, skip the free?
            pass
        else:
            config["devices"]["resampler"] = None
        del config["devices"]["enable_resampling"]

def _modify_devices(config):
    """
    Update the options in the devices section
    """
    # New logic for setting sample format
    dev = config["devices"]["capture"]
    _modify_coreaudio_device(dev)
    dev = config["devices"]["playback"]
    _modify_coreaudio_device(dev)
    
    # Resampler
    _modify_resampler(config)

    # Basic options


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
    Update Dither filters
    """
    pass

def migrate_legacy_config(config):
    """
    Modifies an older config file to the latest format.
    The modifications are done in-place.
    """
    _remove_volume_filters(config)
    _modify_loundness_filters(config)
    _modify_dither(config)
    _modify_devices(config) 

