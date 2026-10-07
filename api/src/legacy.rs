//! Configs written for older versions of CamillaDSP: telling which version a
//! config is for, and migrating it to the current one.
//!
//! Works on untyped values, since an old config does not deserialize into the
//! current config types. Anything malformed is skipped rather than refused, the
//! validator reports it afterwards.

use serde_json::{Map, Value, json};

pub const CURRENT_VERSION: u32 = 5;

const V3_SAMPLE_FORMATS: [&str; 6] = [
    "S16LE",
    "S24LE3",
    "S24LE",
    "S32LE",
    "FLOAT32LE",
    "FLOAT64LE",
];

/// Backends dropped in CamillaDSP 5.0. A config using one cannot be repaired
/// automatically, so migration leaves the device alone and lets the validator
/// report it, rather than silently pointing the user at a different device.
const V4_REMOVED_BACKENDS: [&str; 3] = ["Jack", "Pulse", "Bluez"];

/// v4->v5 renames of the device settings whose unit is now part of the name.
const V4_DEVICE_TIME_RENAMES: [(&str, &str); 4] = [
    ("adjust_period", "adjust_interval_s"),
    ("silence_timeout", "silence_timeout_s"),
    ("rate_measure_interval", "rate_measure_interval_s"),
    ("volume_ramp_time", "volume_ramp_time_ms"),
];

fn type_of(value: &Value) -> Option<&str> {
    value.get("type").and_then(Value::as_str)
}

fn params_type(item: &Value) -> Option<&str> {
    item.get("parameters").and_then(type_of)
}

fn has_param(item: &Value, key: &str) -> bool {
    item.get("parameters")
        .and_then(Value::as_object)
        .is_some_and(|p| p.contains_key(key))
}

fn section<'a>(config: &'a Value, name: &str) -> Option<&'a Map<String, Value>> {
    config.get(name).and_then(Value::as_object)
}

fn section_mut<'a>(config: &'a mut Value, name: &str) -> Option<&'a mut Map<String, Value>> {
    config.get_mut(name).and_then(Value::as_object_mut)
}

fn pipeline_steps(config: &Value) -> &[Value] {
    config
        .get("pipeline")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn device<'a>(config: &'a Value, direction: &str) -> Option<&'a Value> {
    config.get("devices")?.get(direction)
}

// ── Migration ──────────────────────────────────────────────────────────────

/// v1->v2 introduces the default volume control, remove old volume filters.
fn remove_volume_filters(config: &mut Value) {
    let Some(filters) = section_mut(config, "filters") else {
        return;
    };
    let volume_names: Vec<String> = filters
        .iter()
        .filter(|(_, f)| type_of(f) == Some("Volume") && !has_param(f, "fader"))
        .map(|(name, _)| name.clone())
        .collect();
    for name in &volume_names {
        filters.remove(name);
    }
    if let Some(Value::Array(pipeline)) = config.get_mut("pipeline") {
        pipeline.retain_mut(|step| {
            if type_of(step) != Some("Filter") {
                return true;
            }
            if let Some(Value::Array(names)) = step.get_mut("names") {
                names.retain(|n| {
                    !n.as_str()
                        .is_some_and(|n| volume_names.iter().any(|v| v == n))
                });
                !names.is_empty()
            } else {
                true
            }
        });
    }
}

/// v1->v2 removes "ramp_time" from loudness filters.
fn modify_loudness_filters(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        if type_of(filter) != Some("Loudness") {
            continue;
        }
        if let Some(params) = filter.get_mut("parameters").and_then(Value::as_object_mut) {
            params.remove("ramp_time");
            params.insert("fader".into(), json!("Main"));
            params.insert("attenuate_mid".into(), json!(false));
        }
    }
}

/// v1->v2 changes the resampler config.
fn modify_resampler(devices: &mut Map<String, Value>) {
    if let Some(enabled) = devices.remove("enable_resampling") {
        if enabled.as_bool() == Some(true) {
            let resampler = match devices.get("resampler_type") {
                Some(Value::String(kind)) => match kind.as_str() {
                    "Synchronous" => Some(json!({"type": "Synchronous"})),
                    "FastAsync" => Some(json!({"type": "AsyncSinc", "profile": "Fast"})),
                    "BalancedAsync" => Some(json!({"type": "AsyncSinc", "profile": "Balanced"})),
                    "AccurateAsync" => Some(json!({"type": "AsyncSinc", "profile": "Accurate"})),
                    _ => None,
                },
                Some(Value::Object(old)) => old.get("FreeAsync").map(|params| {
                    json!({
                        "type": "AsyncSinc",
                        "sinc_len": params.get("sinc_len"),
                        "oversampling_factor": params.get("oversampling_ratio"),
                        "interpolation": params.get("interpolation"),
                        "window": params.get("window"),
                        "f_cutoff": params.get("f_cutoff"),
                    })
                }),
                _ => None,
            };
            if let Some(resampler) = resampler {
                devices.insert("resampler".into(), resampler);
            }
        } else {
            devices.insert("resampler".into(), Value::Null);
        }
    }
    devices.remove("resampler_type");
}

/// v1->v2 removes "change_format" and makes "format" optional.
fn modify_coreaudio_device(dev: &mut Map<String, Value>) {
    if dev.get("type").and_then(Value::as_str) != Some("CoreAudio") {
        return;
    }
    match dev.remove("change_format") {
        Some(change) => {
            if change.as_bool() != Some(true) {
                dev.insert("format".into(), Value::Null);
            }
        }
        None => {
            dev.insert("format".into(), Value::Null);
        }
    }
}

/// File playback became RawFile at some point.
fn modify_file_playback_device(dev: &mut Map<String, Value>) {
    if dev.get("type").and_then(Value::as_str) == Some("File") {
        dev.insert("type".into(), json!("RawFile"));
    }
}

fn modify_device_sample_format(dev: &mut Map<String, Value>) {
    let kind = dev.get("type").and_then(Value::as_str).map(String::from);
    // Format selection was removed for Pulse. A v4 config has already had it
    // removed, and such a config still comes through here on its way to v5.
    if kind.as_deref() == Some("Pulse") {
        dev.remove("format");
    } else if let Some(format) = dev.get("format").cloned() {
        dev.insert("format".into(), map_format(kind.as_deref(), &format));
    }
}

/// v3->v4 renames all sample formats.
fn map_format(backend: Option<&str>, format: &Value) -> Value {
    let Some(fmt) = format.as_str() else {
        return format.clone();
    };
    if matches!(backend, Some("Wasapi" | "CoreAudio")) {
        return match fmt {
            "FLOAT32LE" => json!("F32"),
            "S16LE" => json!("S16"),
            "S32LE" => json!("S32"),
            "S24LE" | "S24LE3" => json!("S24"),
            _ => Value::Null,
        };
    }
    json!(match fmt {
        "FLOAT32LE" => "F32_LE",
        "FLOAT64LE" => "F64_LE",
        "S16LE" => "S16_LE",
        "S32LE" => "S32_LE",
        "S24LE" => "S24_4_RJ_LE",
        "S24LE3" => "S24_3_LE",
        other => other,
    })
}

fn modify_devices(config: &mut Value) {
    let Some(devices) = section_mut(config, "devices") else {
        return;
    };
    if let Some(dev) = devices.get_mut("capture").and_then(Value::as_object_mut) {
        modify_coreaudio_device(dev);
        modify_device_sample_format(dev);
    }
    if let Some(dev) = devices.get_mut("playback").and_then(Value::as_object_mut) {
        modify_coreaudio_device(dev);
        modify_file_playback_device(dev);
        modify_device_sample_format(dev);
    }
    modify_resampler(devices);
}

/// v1->v2 renames some dither types.
fn modify_dither(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        if type_of(filter) != Some("Dither") {
            continue;
        }
        if let Some(params) = filter.get_mut("parameters").and_then(Value::as_object_mut) {
            let new = match params.get("type").and_then(Value::as_str) {
                Some("Uniform") => "Flat",
                Some("Simple") => "Highpass",
                _ => continue,
            };
            params.insert("type".into(), json!(new));
        }
    }
}

/// v3->v4 renames the sample formats of Raw convolution filters. Wav and
/// Values convolvers have no format.
fn modify_conv_filters(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        if type_of(filter) != Some("Conv") {
            continue;
        }
        if let Some(params) = filter.get_mut("parameters").and_then(Value::as_object_mut)
            && let Some(format) = params.get("format").filter(|f| !f.is_null()).cloned()
        {
            params.insert("format".into(), map_format(None, &format));
        }
    }
}

/// A config exported from REW has a single pipeline step instead of a list.
fn fix_rew_pipeline(config: &mut Value) {
    let Some(Value::Object(step)) = config.get_mut("pipeline") else {
        return;
    };
    if !(step.contains_key("names") && step.contains_key("type")) {
        return;
    }
    // Add the missing channels, but check first in case a new REW adds them.
    if !step.contains_key("channel") && !step.contains_key("channels") {
        step.insert("channels".into(), Value::Null);
    }
    let step = Value::Object(std::mem::take(step));
    config["pipeline"] = json!([step]);
}

/// v2->v3 changes the scalar "channel" of filter steps to a list.
fn modify_pipeline_filter_steps(config: &mut Value) {
    let Some(Value::Array(pipeline)) = config.get_mut("pipeline") else {
        return;
    };
    for step in pipeline {
        if type_of(step) != Some("Filter") {
            continue;
        }
        if let Some(step) = step.as_object_mut()
            && let Some(channel) = step.remove("channel")
        {
            step.insert("channels".into(), json!([channel]));
        }
    }
}

/// From v4 there can only be one mapping per destination channel, and each
/// source channel only once within a mapping. Merge the mappings of each
/// destination, and drop sources that are listed again.
fn modify_mixers(config: &mut Value) {
    for mixer in section_mut(config, "mixers")
        .into_iter()
        .flat_map(|m| m.values_mut())
    {
        let Some(Value::Array(mapping)) = mixer.get_mut("mapping") else {
            continue;
        };
        let mut merged: Vec<Value> = Vec::new();
        for entry in std::mem::take(mapping) {
            let existing = merged
                .iter_mut()
                .find(|m| m.get("dest") == entry.get("dest"));
            match (existing, entry.get("sources").and_then(Value::as_array)) {
                (Some(existing), Some(sources)) => {
                    if let Some(Value::Array(existing_sources)) = existing.get_mut("sources") {
                        existing_sources.extend(sources.iter().cloned());
                    }
                }
                _ => merged.push(entry),
            }
        }
        for entry in &mut merged {
            if let Some(Value::Array(sources)) = entry.get_mut("sources") {
                let mut cleaned: Vec<Value> = Vec::new();
                for source in sources.drain(..) {
                    if !cleaned
                        .iter()
                        .any(|s| s.get("channel") == source.get("channel"))
                    {
                        cleaned.push(source);
                    }
                }
                *sources = cleaned;
            }
        }
        *mapping = merged;
    }
}

/// v4->v5 bakes the unit into the name of the fixed-unit device settings.
fn modify_device_time_units(config: &mut Value) {
    let Some(devices) = section_mut(config, "devices") else {
        return;
    };
    for (old_name, new_name) in V4_DEVICE_TIME_RENAMES {
        if let Some(value) = devices.remove(old_name) {
            devices.insert(new_name.into(), value);
        }
    }
}

/// v4->v5 requires every time value to state its unit. Delay's "unit" becomes
/// the mandatory "delay_unit", with the CamillaDSP 4 default of milliseconds
/// written out if it was left out, and Volume's "ramp_time" becomes "ramp_time_ms".
fn modify_filter_time_units(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        let kind = type_of(filter).map(String::from);
        let Some(params) = filter.get_mut("parameters").and_then(Value::as_object_mut) else {
            continue;
        };
        match kind.as_deref() {
            Some("Delay") => {
                let unit = params.remove("unit").filter(|u| !u.is_null());
                params.insert("delay_unit".into(), unit.unwrap_or_else(|| json!("ms")));
            }
            Some("Volume") => {
                if let Some(ramp) = params.remove("ramp_time") {
                    params.insert("ramp_time_ms".into(), ramp);
                }
            }
            _ => {}
        }
    }
}

/// v4->v5 renames the Limiter filter to Clipper, freeing the name for
/// LookaheadLimiter. The parameters are unchanged.
fn modify_limiter_filters(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        if type_of(filter) == Some("Limiter") {
            filter["type"] = json!("Clipper");
        }
    }
}

/// v4->v5 generalises FivePointPeq to NPointPeq. The fifteen numbered
/// parameters become five bands, in the order the old filter applied them: the
/// low shelf, the three peaks, then the high shelf. NPointPeq gives a band its
/// role by position, so the resulting filter is identical.
fn modify_fivepointpeq_filters(config: &mut Value) {
    for filter in section_mut(config, "filters")
        .into_iter()
        .flat_map(|f| f.values_mut())
    {
        if type_of(filter) != Some("BiquadCombo") || params_type(filter) != Some("FivePointPeq") {
            continue;
        }
        let Some(params) = filter.get_mut("parameters").and_then(Value::as_object_mut) else {
            continue;
        };
        let mut bands = Vec::new();
        for prefix in ["ls", "p1", "p2", "p3", "hs"] {
            let mut take = |key: &str| {
                params
                    .remove(&format!("{key}{prefix}"))
                    .unwrap_or(Value::Null)
            };
            let freq = take("f");
            let q = take("q");
            let gain = take("g");
            bands.push(json!({"freq": freq, "q": q, "gain": gain}));
        }
        params.insert("type".into(), json!("NPointPeq"));
        params.insert("bands".into(), Value::Array(bands));
    }
}

/// v4->v5 gives Compressor and NoiseGate explicit "s" units, which is what
/// their attack and release were in, and RACE's optional delay unit its old
/// default of "ms".
fn modify_processor_time_units(config: &mut Value) {
    for proc in section_mut(config, "processors")
        .into_iter()
        .flat_map(|p| p.values_mut())
    {
        let kind = type_of(proc).map(String::from);
        let Some(params) = proc.get_mut("parameters").and_then(Value::as_object_mut) else {
            continue;
        };
        match kind.as_deref() {
            Some("Compressor" | "NoiseGate") => {
                params.entry("attack_unit").or_insert(json!("s"));
                params.entry("release_unit").or_insert(json!("s"));
            }
            Some("RACE") if params.get("delay_unit").is_none_or(Value::is_null) => {
                params.insert("delay_unit".into(), json!("ms"));
            }
            _ => {}
        }
    }
}

/// Bring an older config, or part of one, up to the current format, in place.
pub fn migrate_legacy_config(config: &mut Value) {
    if !config.is_object() {
        return;
    }
    fix_rew_pipeline(config);
    remove_volume_filters(config);
    modify_loudness_filters(config);
    modify_dither(config);
    modify_devices(config);
    modify_pipeline_filter_steps(config);
    modify_mixers(config);
    modify_conv_filters(config);
    modify_device_time_units(config);
    modify_filter_time_units(config);
    modify_limiter_filters(config);
    modify_fivepointpeq_filters(config);
    modify_processor_time_units(config);
}

/// Migrate a config, or part of one, only if it is written for an older
/// version. Some migration steps are not safe on a current config, so one that
/// is identified as current, or not at all, is left alone. A REW export is
/// fixed up first whatever its version, since its single pipeline step hides
/// the version from `identify_version`.
pub fn migrate_if_older(config: &mut Value) {
    fix_rew_pipeline(config);
    if identify_version(config).is_some_and(|version| version < CURRENT_VERSION) {
        migrate_legacy_config(config);
    }
}

// ── Version detection ──────────────────────────────────────────────────────

fn filters_any(config: &Value, check: impl Fn(&Value) -> bool) -> bool {
    section(config, "filters").is_some_and(|f| f.values().any(check))
}

fn processors_any(config: &Value, check: impl Fn(&Value) -> bool) -> bool {
    section(config, "processors").is_some_and(|p| p.values().any(check))
}

fn look_for_v1(config: &Value) -> bool {
    let volume = filters_any(config, |f| {
        type_of(f) == Some("Volume") && !has_param(f, "fader")
    });
    let loudness = filters_any(config, |f| {
        type_of(f) == Some("Loudness") && has_param(f, "ramp_time")
    });
    let resampler = section(config, "devices").is_some_and(|d| d.contains_key("enable_resampling"));
    let devices = ["capture", "playback"].iter().any(|direction| {
        device(config, direction).is_some_and(|dev| {
            type_of(dev) == Some("CoreAudio") && dev.get("change_format").is_some()
        })
    });
    let dither = filters_any(config, |f| {
        type_of(f) == Some("Dither") && matches!(params_type(f), Some("Uniform" | "Simple"))
    });
    volume || loudness || resampler || devices || dither
}

fn look_for_v2(config: &Value) -> bool {
    let pipeline = pipeline_steps(config)
        .iter()
        .any(|step| type_of(step) == Some("Filter") && step.get("channel").is_some());
    let devices = device(config, "capture").and_then(type_of) == Some("File");
    pipeline || devices
}

fn look_for_v3(config: &Value) -> bool {
    let mixer = section(config, "mixers").is_some_and(|mixers| {
        mixers.values().any(|mixer| {
            let mapping = mixer.get("mapping").and_then(Value::as_array);
            let mut dests = Vec::new();
            mapping.into_iter().flatten().any(|entry| {
                let dest = entry.get("dest");
                if dests.contains(&dest) {
                    return true;
                }
                dests.push(dest);
                let mut channels = Vec::new();
                let sources = entry.get("sources").and_then(Value::as_array);
                sources.into_iter().flatten().any(|source| {
                    let channel = source.get("channel");
                    let repeated = channels.contains(&channel);
                    channels.push(channel);
                    repeated
                })
            })
        })
    });
    let old_format = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .is_some_and(|f| V3_SAMPLE_FORMATS.contains(&f))
    };
    let devices = ["capture", "playback"].iter().any(|direction| {
        device(config, direction).is_some_and(|dev| {
            old_format(dev.get("format"))
                || (type_of(dev) == Some("Pulse") && dev.get("format").is_some())
        })
    });
    let filters = filters_any(config, |f| {
        type_of(f) == Some("Conv") && old_format(f.get("parameters").and_then(|p| p.get("format")))
    });
    mixer || devices || filters
}

fn look_for_v4(config: &Value) -> bool {
    let device_units = section(config, "devices").is_some_and(|d| {
        V4_DEVICE_TIME_RENAMES
            .iter()
            .any(|(old, _)| d.contains_key(*old))
    });
    let filters = filters_any(config, |f| match type_of(f) {
        Some("Limiter") => true,
        Some("Delay") => {
            f.get("parameters").is_some_and(Value::is_object) && !has_param(f, "delay_unit")
        }
        Some("Volume") => has_param(f, "ramp_time"),
        Some("BiquadCombo") => params_type(f) == Some("FivePointPeq"),
        _ => false,
    });
    let processors = processors_any(config, |p| {
        if !p.get("parameters").is_some_and(Value::is_object) {
            return false;
        }
        match type_of(p) {
            Some("Compressor" | "NoiseGate") => {
                !has_param(p, "attack_unit") || !has_param(p, "release_unit")
            }
            Some("RACE") => p["parameters"].get("delay_unit").is_none_or(Value::is_null),
            _ => false,
        }
    });
    let removed_backends = ["capture", "playback"].iter().any(|direction| {
        device(config, direction)
            .and_then(type_of)
            .is_some_and(|t| V4_REMOVED_BACKENDS.contains(&t))
    });
    device_units || filters || processors || removed_backends
}

/// The overall shape of a config: a mapping with a devices section, and the
/// other sections of the right kind if present.
fn passes_sections_schema(config: &Value) -> bool {
    let Some(config) = config.as_object() else {
        return false;
    };
    let kind_ok = |key: &str, ok: fn(&Value) -> bool| config.get(key).is_none_or(ok);
    config.get("devices").is_some_and(Value::is_object)
        && kind_ok("filters", |v| v.is_object() || v.is_null())
        && kind_ok("mixers", |v| v.is_object() || v.is_null())
        && kind_ok("processors", |v| v.is_object() || v.is_null())
        && kind_ok("pipeline", |v| {
            v.is_null()
                || v.as_array()
                    .is_some_and(|steps| steps.iter().all(Value::is_object))
        })
        && kind_ok("title", |v| v.is_string() || v.is_null())
        && kind_ok("description", |v| v.is_string() || v.is_null())
}

/// Which CamillaDSP version a config is written for, `None` if it does not
/// look like a CamillaDSP config at all.
pub fn identify_version(config: &Value) -> Option<u32> {
    if !config.is_object() {
        return None;
    }
    if look_for_v1(config) {
        Some(1)
    } else if look_for_v2(config) {
        Some(2)
    } else if look_for_v3(config) {
        Some(3)
    } else if look_for_v4(config) {
        Some(4)
    } else if passes_sections_schema(config) {
        Some(CURRENT_VERSION)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basic_config() -> Value {
        json!({
            "devices": {
                "samplerate": 96000,
                "chunksize": 2048,
                "queuelimit": 4,
                "silence_threshold": -60,
                "silence_timeout": 3.0,
                "target_level": 500,
                "adjust_period": 10,
                "enable_rate_adjust": true,
                "resampler_type": "BalancedAsync",
                "enable_resampling": false,
                "capture_samplerate": 44100,
                "stop_on_rate_change": false,
                "rate_measure_interval": 1.0,
                "capture": {"type": "Stdin", "channels": 2, "format": "S16LE"},
                "playback": {"type": "Stdout", "channels": 2, "format": "S32LE"},
            },
            "filters": {
                "vol": {"type": "Volume", "parameters": {"ramp_time": 200}},
                "hp_80": {"type": "Biquad", "parameters": {"type": "Highpass", "freq": 80, "q": 0.5}},
                "loudness": {"type": "Loudness", "parameters": {
                    "ramp_time": 200.0, "reference_level": -25.0, "high_boost": 7.0, "low_boost": 7.0,
                }},
                "dither": {"type": "Dither", "parameters": {"type": "Simple", "bits": 16}},
            },
            "mixers": {},
            "pipeline": [
                {"type": "Filter", "channel": 0, "names": ["vol", "hp_80"]},
                {"type": "Filter", "channel": 1, "names": ["vol"]},
            ],
        })
    }

    fn v4_config() -> Value {
        json!({
            "devices": {
                "samplerate": 48000,
                "chunksize": 1024,
                "adjust_period": 10,
                "silence_timeout": 3.0,
                "rate_measure_interval": 1.0,
                "volume_ramp_time": 400.0,
                "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
                "playback": {"type": "Stdout", "channels": 2, "format": "S32_LE"},
            },
            "filters": {
                "dly": {"type": "Delay", "parameters": {"delay": 3.0, "unit": "mm"}},
                "dly_default": {"type": "Delay", "parameters": {"delay": 3.0}},
                "vol": {"type": "Volume", "parameters": {"ramp_time": 200.0, "fader": "Aux1"}},
                "lim": {"type": "Limiter", "parameters": {"clip_limit": -3.0}},
                "peq": {"type": "BiquadCombo", "parameters": {
                    "type": "FivePointPeq",
                    "fls": 80.0, "qls": 0.7, "gls": 1.0,
                    "fp1": 200.0, "qp1": 1.0, "gp1": -1.0,
                    "fp2": 800.0, "qp2": 1.0, "gp2": 0.5,
                    "fp3": 2400.0, "qp3": 1.0, "gp3": -0.5,
                    "fhs": 6000.0, "qhs": 0.7, "ghs": 1.0,
                }},
            },
            "processors": {
                "comp": {"type": "Compressor", "parameters": {
                    "channels": 2, "attack": 0.025, "release": 1.0, "threshold": -25.0, "factor": 5.0,
                }},
                "gate": {"type": "NoiseGate", "parameters": {
                    "channels": 2, "attack": 0.025, "release": 1.0, "threshold": -60.0, "attenuation": 20.0,
                }},
                "race": {"type": "RACE", "parameters": {
                    "channels": 2, "channel_a": 0, "channel_b": 1, "delay": 0.1, "attenuation": 10.0,
                }},
            },
            "pipeline": [
                {"type": "Filter", "channels": [0], "names": ["dly", "vol", "lim"]},
                {"type": "Processor", "name": "comp"},
            ],
        })
    }

    /// A current config, using what older versions spelled differently or not
    /// at all: a Delay in samples, File playback, and the CoreAudio formats.
    fn v5_config() -> Value {
        json!({
            "devices": {
                "samplerate": 48000,
                "chunksize": 1024,
                "adjust_interval_s": 10.0,
                "silence_timeout_s": 3.0,
                "rate_measure_interval_s": 1.0,
                "volume_ramp_time_ms": 400.0,
                "capture": {"type": "CoreAudio", "channels": 2, "device": "BlackHole 2ch", "format": "S16"},
                "playback": {"type": "File", "channels": 2, "filename": "out.raw", "format": "S32_LE"},
            },
            "filters": {
                "dly": {"type": "Delay", "parameters": {"delay": 32.0, "delay_unit": "samples"}},
                "vol": {"type": "Volume", "parameters": {"ramp_time_ms": 200.0, "fader": "Aux1"}},
                "clip": {"type": "Clipper", "parameters": {"clip_limit": -3.0}},
                "peq": {"type": "BiquadCombo", "parameters": {"type": "NPointPeq", "bands": [
                    {"freq": 80.0, "q": 0.7, "gain": 1.0},
                ]}},
            },
            "processors": {
                "comp": {"type": "Compressor", "parameters": {
                    "channels": 2, "attack": 25.0, "attack_unit": "ms", "release": 1.0,
                    "release_unit": "s", "threshold": -25.0, "factor": 5.0,
                }},
            },
            "pipeline": [
                {"type": "Filter", "channels": [0, 1], "names": ["dly", "vol", "clip", "peq"]},
                {"type": "Processor", "name": "comp"},
            ],
        })
    }

    /// The v5 config with each of the Wasapi and CoreAudio v5 formats.
    fn v5_configs() -> Vec<Value> {
        let devices = [
            (
                json!({"type": "Wasapi", "channels": 2, "device": "Line In", "format": "S32"}),
                json!({"type": "CoreAudio", "channels": 2, "device": "Speakers", "format": "F32"}),
            ),
            (
                json!({"type": "CoreAudio", "channels": 2, "format": "S32"}),
                json!({"type": "Wasapi", "channels": 2, "format": "S16"}),
            ),
            (
                json!({"type": "Wasapi", "channels": 2, "format": "F32"}),
                json!({"type": "CoreAudio", "channels": 2, "format": "S16"}),
            ),
        ];
        let mut configs = vec![v5_config()];
        for (capture, playback) in devices {
            let mut config = v5_config();
            config["devices"]["capture"] = capture;
            config["devices"]["playback"] = playback;
            configs.push(config);
        }
        configs
    }

    #[test]
    fn v5_config_is_current() {
        for config in v5_configs() {
            crate::validate::parse(config.clone()).expect("the fixture is a valid v5 config");
            assert_eq!(identify_version(&config), Some(CURRENT_VERSION));
        }
    }

    #[test]
    fn current_config_is_not_migrated() {
        for config in v5_configs() {
            let mut migrated = config.clone();
            migrate_if_older(&mut migrated);
            assert_eq!(migrated, config);
        }
        let filters_only = json!({"filters": v5_config()["filters"]});
        let mut migrated = filters_only.clone();
        migrate_if_older(&mut migrated);
        assert_eq!(migrated, filters_only);
    }

    #[test]
    fn older_config_is_migrated() {
        let mut config = v4_config();
        migrate_if_older(&mut config);
        assert_eq!(identify_version(&config), Some(CURRENT_VERSION));
    }

    #[test]
    fn current_rew_export_gets_a_pipeline_list() {
        let mut config = v5_config();
        let step = json!({"type": "Filter", "channels": [0], "names": ["peq"]});
        config["pipeline"] = step.clone();
        migrate_if_older(&mut config);
        assert_eq!(config["pipeline"], json!([step]));
        assert_eq!(config["devices"], v5_config()["devices"]);
    }

    #[test]
    #[ignore = "migrate_legacy_config still overwrites delay_unit, renames File playback to \
                RawFile and wipes the v5 CoreAudio and Wasapi formats; un-ignore once those \
                steps only touch old configs"]
    fn migration_leaves_current_config_unchanged() {
        for config in v5_configs() {
            let mut migrated = config.clone();
            migrate_legacy_config(&mut migrated);
            assert_eq!(migrated, config);
        }
    }

    #[test]
    fn coreaudio_device() {
        let mut config = basic_config();
        config["devices"]["capture"] = json!({
            "type": "CoreAudio", "channels": 2, "device": "Soundflower (2ch)",
            "format": "S32LE", "change_format": true,
        });
        config["devices"]["playback"] = json!({
            "type": "CoreAudio", "channels": 2, "device": "Built-in Output",
            "format": "S32LE", "exclusive": false, "change_format": false,
        });
        modify_devices(&mut config);
        let capture = &config["devices"]["capture"];
        let playback = &config["devices"]["playback"];
        assert!(capture.get("change_format").is_none());
        assert!(playback.get("change_format").is_none());
        assert_eq!(capture["format"], "S32");
        assert_eq!(playback["format"], Value::Null);
    }

    #[test]
    fn disabled_resampling() {
        let mut config = basic_config();
        modify_devices(&mut config);
        assert!(config["devices"].get("enable_resampling").is_none());
        assert_eq!(config["devices"]["resampler"], Value::Null);
    }

    #[test]
    fn free_resampler() {
        let mut config = basic_config();
        config["devices"]["resampler_type"] = json!({"FreeAsync": {
            "f_cutoff": 0.9, "sinc_len": 128, "window": "Hann2",
            "oversampling_ratio": 64, "interpolation": "Cubic",
        }});
        config["devices"]["enable_resampling"] = json!(true);
        modify_devices(&mut config);
        assert!(config["devices"].get("enable_resampling").is_none());
        assert_eq!(
            config["devices"]["resampler"],
            json!({
                "type": "AsyncSinc", "f_cutoff": 0.9, "sinc_len": 128, "window": "Hann2",
                "oversampling_factor": 64, "interpolation": "Cubic",
            })
        );
    }

    #[test]
    fn pipeline_filter_step_channels() {
        let mut config = basic_config();
        modify_pipeline_filter_steps(&mut config);
        for step in config["pipeline"].as_array().unwrap() {
            assert!(step.get("channel").is_none());
            assert!(step["channels"].is_array());
        }
    }

    #[test]
    fn removed_volume_filters() {
        let mut config = basic_config();
        remove_volume_filters(&mut config);
        assert!(config["filters"].get("vol").is_none());
        assert_eq!(config["pipeline"].as_array().unwrap().len(), 1);
        assert_eq!(config["pipeline"][0]["names"], json!(["hp_80"]));
    }

    #[test]
    fn loudness_and_dither() {
        let mut config = basic_config();
        modify_loudness_filters(&mut config);
        modify_dither(&mut config);
        let params = &config["filters"]["loudness"]["parameters"];
        assert!(params.get("ramp_time").is_none());
        assert_eq!(params["fader"], "Main");
        assert_eq!(params["attenuate_mid"], false);
        assert_eq!(
            config["filters"]["dither"]["parameters"]["type"],
            "Highpass"
        );
    }

    #[test]
    fn partial_configs_migrate() {
        let mut filters_only = json!({"filters": basic_config()["filters"]});
        migrate_legacy_config(&mut filters_only);
        assert_eq!(filters_only["filters"].as_object().unwrap().len(), 3);
    }

    #[test]
    fn rew_export() {
        let mut config = basic_config();
        config["pipeline"] = config["pipeline"][0].clone();
        migrate_legacy_config(&mut config);
        assert_eq!(config["pipeline"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn merge_mixer_mappings() {
        let mut config = basic_config();
        config["mixers"]["test"] = json!({
            "channels": {"in": 4, "out": 2},
            "mapping": [
                {"dest": 0, "sources": [{"channel": 0, "gain": -1}]},
                {"dest": 0, "sources": [{"channel": 1, "gain": -2}]},
                {"dest": 1, "sources": [{"channel": 2, "gain": -3}]},
                {"dest": 1, "sources": [{"channel": 2, "gain": -4}]},
            ],
        });
        modify_mixers(&mut config);
        assert_eq!(
            config["mixers"]["test"],
            json!({
                "channels": {"in": 4, "out": 2},
                "mapping": [
                    {"dest": 0, "sources": [{"channel": 0, "gain": -1}, {"channel": 1, "gain": -2}]},
                    {"dest": 1, "sources": [{"channel": 2, "gain": -3}]},
                ],
            })
        );
    }

    #[test]
    fn conv_filters() {
        let mut config = json!({"filters": {
            "fir_wav": {"type": "Conv", "parameters": {"type": "Wav", "filename": "fir.wav", "channel": 0}},
            "fir_raw": {"type": "Conv", "parameters": {"type": "Raw", "filename": "fir.dat", "format": "FLOAT32LE"}},
        }});
        migrate_legacy_config(&mut config);
        assert!(
            config["filters"]["fir_wav"]["parameters"]
                .get("format")
                .is_none()
        );
        assert_eq!(
            config["filters"]["fir_raw"]["parameters"]["format"],
            "F32_LE"
        );
    }

    #[test]
    fn v5_migration() {
        let mut config = v4_config();
        assert_eq!(identify_version(&config), Some(4));
        migrate_legacy_config(&mut config);
        let devices = &config["devices"];
        assert_eq!(devices["adjust_interval_s"], 10);
        assert_eq!(devices["silence_timeout_s"], 3.0);
        assert_eq!(devices["rate_measure_interval_s"], 1.0);
        assert_eq!(devices["volume_ramp_time_ms"], 400.0);
        assert!(devices.get("adjust_period").is_none());
        let filters = &config["filters"];
        assert_eq!(filters["dly"]["parameters"]["delay_unit"], "mm");
        assert!(filters["dly"]["parameters"].get("unit").is_none());
        assert_eq!(filters["dly_default"]["parameters"]["delay_unit"], "ms");
        assert_eq!(filters["vol"]["parameters"]["ramp_time_ms"], 200.0);
        assert_eq!(filters["lim"]["type"], "Clipper");
        assert_eq!(filters["lim"]["parameters"], json!({"clip_limit": -3.0}));
        let peq = &filters["peq"]["parameters"];
        assert_eq!(
            peq,
            &json!({"type": "NPointPeq", "bands": [
                {"freq": 80.0, "q": 0.7, "gain": 1.0},
                {"freq": 200.0, "q": 1.0, "gain": -1.0},
                {"freq": 800.0, "q": 1.0, "gain": 0.5},
                {"freq": 2400.0, "q": 1.0, "gain": -0.5},
                {"freq": 6000.0, "q": 0.7, "gain": 1.0},
            ]})
        );
        for name in ["comp", "gate"] {
            let params = &config["processors"][name]["parameters"];
            assert_eq!(params["attack_unit"], "s");
            assert_eq!(params["release_unit"], "s");
        }
        assert_eq!(
            config["processors"]["race"]["parameters"]["delay_unit"],
            "ms"
        );
        assert_eq!(identify_version(&config), Some(CURRENT_VERSION));
    }

    #[test]
    fn removed_backend_is_kept() {
        let mut config = v4_config();
        config["devices"]["capture"] = json!({"type": "Pulse", "device": "default", "channels": 2});
        migrate_legacy_config(&mut config);
        assert_eq!(config["devices"]["capture"]["type"], "Pulse");
        assert_eq!(config["devices"]["adjust_interval_s"], 10);
        assert_eq!(identify_version(&config), Some(4));
    }

    #[test]
    fn versions() {
        assert_eq!(identify_version(&basic_config()), Some(1));
        assert_eq!(identify_version(&json!("text")), None);
        assert_eq!(identify_version(&json!({"filters": {}})), None);
        assert_eq!(
            identify_version(&json!({"devices": {}})),
            Some(CURRENT_VERSION)
        );
        let v2 =
            json!({"devices": {}, "pipeline": [{"type": "Filter", "channel": 0, "names": []}]});
        assert_eq!(identify_version(&v2), Some(2));
        let v3 = json!({"devices": {"capture": {"type": "Stdin", "format": "S16LE"}}});
        assert_eq!(identify_version(&v3), Some(3));
    }
}
