from backend.dsp.validate_config import CamillaValidator

CURRENT_VERSION = 5

V3_SAMPLE_FORMATS = ("S16LE", "S24LE3", "S24LE", "S32LE", "FLOAT32LE", "FLOAT64LE")

# Backends dropped in CamillaDSP 5.0. A config using one cannot be repaired
# automatically, so migration leaves the device alone and lets the validator
# report it, rather than silently pointing the user at a different device.
V4_REMOVED_BACKENDS = ("Jack", "Pulse", "Bluez")

# v4->v5 renames of the device settings whose unit is now part of the name
V4_DEVICE_TIME_RENAMES = {
    "adjust_period": "adjust_interval_s",
    "silence_timeout": "silence_timeout_s",
    "rate_measure_interval": "rate_measure_interval_s",
    "volume_ramp_time": "volume_ramp_time_ms",
}

_VALIDATOR = CamillaValidator()


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
        for _name, params in config["filters"].items():
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
            _modify_device_sample_format(dev)
        if "playback" in config["devices"]:
            dev = config["devices"]["playback"]
            _modify_coreaudio_device(dev)
            _modify_file_playback_device(dev)
            _modify_device_sample_format(dev)

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


# v3->v4 changes all sample format names
def _modify_conv_filters(config):
    if "filters" in config:
        for _name, filt in config["filters"].items():
            if filt["type"] == "Conv":
                filt["parameters"]["format"] = _map_format(
                    None, filt["parameters"]["format"]
                )


def _modify_device_sample_format(dev):
    # Remove format for Pulse. A v4 config has already had it removed, and
    # such a config still comes through here on its way to v5.
    if dev["type"] == "Pulse":
        dev.pop("format", None)
    elif "format" in dev:
        dev["format"] = _map_format(dev["type"], dev["format"])


def _map_format(backend, fmt):
    if fmt is None:
        # Nothing to do, return early
        return None
    if backend in ("Wasapi", "CoreAudio"):
        if fmt == "FLOAT32LE":
            return "F32"
        if fmt == "S16LE":
            return "S16"
        if fmt == "S32LE":
            return "S32"
        if fmt in ("S24LE", "S24LE3"):
            return "S24"
        return None
    if fmt == "FLOAT32LE":
        return "F32_LE"
    if fmt == "FLOAT64LE":
        return "F64_LE"
    if fmt == "S16LE":
        return "S16_LE"
    if fmt == "S32LE":
        return "S32_LE"
    if fmt == "S24LE":
        return "S24_4_RJ_LE"
    if fmt == "S24LE3":
        return "S24_3_LE"
    return fmt


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


# Starting from v4, there can only be one mapping per desitiantion channel,
# and within a mapping, each source channel can only be used once.
# Migrate by merging mappings for the same destination.
# If a mapping ends up containing the same source channel more than once,
# drop the extras.
def _modify_mixers(config):
    if "mixers" not in config or config["mixers"] is None:
        return
    for _, mixer in config["mixers"].items():
        merged_mappings = []
        # step 1, merge mappings
        for mapping in mixer["mapping"]:
            existing = next(
                (m for m in merged_mappings if m["dest"] == mapping["dest"]), None
            )
            if existing is not None:
                existing["sources"].extend(mapping["sources"])
            else:
                merged_mappings.append(mapping)
        # step 2: remove duplicated sources in each mapping
        for mapping in merged_mappings:
            cleaned_sources = []
            for source in mapping["sources"]:
                if any(s["channel"] == source["channel"] for s in cleaned_sources):
                    continue
                cleaned_sources.append(source)
            mapping["sources"] = cleaned_sources
        mixer["mapping"] = merged_mappings


# v4->v5 bakes the unit into the name of the fixed-unit device settings
def _modify_device_time_units(config):
    """
    Rename the device settings whose unit is now part of the field name.
    The values are unchanged, only the keys move.
    """
    devices = config.get("devices")
    if not isinstance(devices, dict):
        return
    for old_name, new_name in V4_DEVICE_TIME_RENAMES.items():
        if old_name in devices:
            devices[new_name] = devices.pop(old_name)


# v4->v5 requires every time value to state its unit
def _modify_filter_time_units(config):
    """
    Give Delay and Volume filters their v5 keys.

    Delay's "unit" becomes "delay_unit" and is now mandatory, so a config
    that left it out gets the CamillaDSP 4 default of milliseconds written
    out explicitly. Volume's "ramp_time" becomes "ramp_time_ms".
    """
    filters = config.get("filters")
    if not isinstance(filters, dict):
        return
    for _name, filt in filters.items():
        params = filt.get("parameters")
        if not isinstance(params, dict):
            continue
        if filt["type"] == "Delay":
            unit = params.pop("unit", None)
            params["delay_unit"] = unit if unit is not None else "ms"
        elif filt["type"] == "Volume" and "ramp_time" in params:
            params["ramp_time_ms"] = params.pop("ramp_time")


# v4->v5 renames the Limiter filter, freeing the name for LookaheadLimiter
def _modify_limiter_filters(config):
    """
    Rename Limiter filters to Clipper. The parameters are unchanged.
    """
    filters = config.get("filters")
    if not isinstance(filters, dict):
        return
    for _name, filt in filters.items():
        if filt["type"] == "Limiter":
            filt["type"] = "Clipper"


# v4->v5 requires every time value to state its unit
def _modify_processor_time_units(config):
    """
    Give the processors their mandatory unit fields.

    Compressor and NoiseGate took attack and release in seconds, so they get
    an explicit "s". RACE's delay_unit was optional and defaulted to
    milliseconds, so a missing or null one becomes "ms".
    """
    processors = config.get("processors")
    if not isinstance(processors, dict):
        return
    for _name, proc in processors.items():
        params = proc.get("parameters")
        if not isinstance(params, dict):
            continue
        if proc["type"] in ("Compressor", "NoiseGate"):
            params.setdefault("attack_unit", "s")
            params.setdefault("release_unit", "s")
        elif proc["type"] == "RACE":
            if params.get("delay_unit") is None:
                params["delay_unit"] = "ms"


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
    _modify_mixers(config)
    _modify_conv_filters(config)
    _modify_device_time_units(config)
    _modify_filter_time_units(config)
    _modify_limiter_filters(config)
    _modify_processor_time_units(config)


def _look_for_v1_volume(config):
    if "filters" in config and isinstance(config["filters"], dict):
        for _name, params in list(config["filters"].items()):
            if params["type"] == "Volume" and "fader" not in params["parameters"]:
                return True
    return False


def _look_for_v1_loudness(config):
    if "filters" in config and isinstance(config["filters"], dict):
        for _name, params in config["filters"].items():
            if params["type"] == "Loudness" and "ramp_time" in params["parameters"]:
                return True
    return False


def _look_for_v1_resampler(config):
    return "devices" in config and "enable_resampling" in config["devices"]


def _look_for_v1_devices(config):
    if "devices" in config:
        for direction in ("capture", "playback"):
            if (
                direction in config["devices"]
                and "type" in config["devices"][direction]
            ):
                if (
                    config["devices"][direction]["type"] == "CoreAudio"
                    and "change_format" in config["devices"][direction]
                ):
                    return True
    return False


def _look_for_v2_devices(config):
    return (
        "devices" in config
        and "capture" in config["devices"]
        and config["devices"]["capture"]["type"] == "File"
    )


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


def _look_for_v3_mixer(config):
    if "mixers" in config and isinstance(config["mixers"], dict):
        for _mixername, mixerconf in config["mixers"].items():
            output_channels = set()
            for mapping in mixerconf["mapping"]:
                # Check that there is no more than one mapping for each output channel
                if mapping["dest"] in output_channels:
                    return True
                output_channels.add(mapping["dest"])

                input_channels = set()
                for source in mapping["sources"]:
                    # Check that each input channel is not listed more than once in a mapping
                    if source["channel"] in input_channels:
                        return True
                    input_channels.add(source["channel"])
    return False


def _look_for_v3_sample_formats(config):
    # Check for old sample formats in devices and Conv filters
    if "devices" in config:
        for direction in ("capture", "playback"):
            device = config["devices"][direction]
            if "format" in device and device["format"] in V3_SAMPLE_FORMATS:
                return True
            if device["type"] == "Pulse" and "format" in device:
                # Format selection was removed from the Pulse backend
                return True
    if "filters" in config and isinstance(config["filters"], dict):
        for _name, filt in config["filters"].items():
            if filt["type"] == "Conv" and "format" in filt["parameters"]:
                if filt["parameters"]["format"] in V3_SAMPLE_FORMATS:
                    return True
    return False


def _look_for_v4_device_time_units(config):
    # The fixed-unit device settings were renamed in v5
    devices = config.get("devices")
    if isinstance(devices, dict):
        if any(old_name in devices for old_name in V4_DEVICE_TIME_RENAMES):
            return True
    return False


def _look_for_v4_removed_backends(config):
    # Jack, Pulse and Bluez were dropped in v5. Such a config cannot be
    # repaired, but it is still worth migrating everything else so the only
    # thing the user has to fix is the device itself.
    devices = config.get("devices")
    if isinstance(devices, dict):
        for direction in ("capture", "playback"):
            device = devices.get(direction)
            if isinstance(device, dict) and device.get("type") in V4_REMOVED_BACKENDS:
                return True
    return False


def _look_for_v4_filters(config):
    # Delay took "unit", Volume took "ramp_time", and Limiter became Clipper
    filters = config.get("filters")
    if isinstance(filters, dict):
        for _name, filt in filters.items():
            if filt["type"] == "Limiter":
                return True
            params = filt.get("parameters")
            if not isinstance(params, dict):
                continue
            if filt["type"] == "Delay" and "delay_unit" not in params:
                return True
            if filt["type"] == "Volume" and "ramp_time" in params:
                return True
    return False


def _look_for_v4_processors(config):
    # attack_unit, release_unit and RACE's delay_unit are all mandatory in v5
    processors = config.get("processors")
    if isinstance(processors, dict):
        for _name, proc in processors.items():
            params = proc.get("parameters")
            if not isinstance(params, dict):
                continue
            if proc["type"] in ("Compressor", "NoiseGate"):
                if "attack_unit" not in params or "release_unit" not in params:
                    return True
            elif proc["type"] == "RACE" and params.get("delay_unit") is None:
                return True
    return False


def identify_version(config):
    if not isinstance(config, dict):
        return None

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
    if _look_for_v3_mixer(config):
        return 3
    if _look_for_v3_sample_formats(config):
        return 3
    if _look_for_v4_device_time_units(config):
        return 4
    if _look_for_v4_filters(config):
        return 4
    if _look_for_v4_processors(config):
        return 4
    if _look_for_v4_removed_backends(config):
        return 4
    if _VALIDATOR.passes_sections_schema(config):
        return CURRENT_VERSION
    return None
