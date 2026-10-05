//! Keeps the frontend's filter fixture in step with camilladsp-config.
//!
//! `frontend/src/camilladsp/eval/fixtures/variants.json` holds filter configs
//! that the frontend's `variants.test.ts` evaluates. Each comes twice, as a
//! user writes it and with the `-defaults` suffix as this backend sends it,
//! with every optional field filled in. These tests check the fixture against
//! the filter types:
//! - every case parses, and its `-defaults` twin is what `with_defaults` makes,
//! - every filter type and subtype has a case,
//! - every optional parameter is set in at least one case.
//!
//! A new filter type, subtype or parameter in camilladsp-config makes
//! `parameters` below fail to compile. Add it there, then add cases to the
//! fixture until these tests pass, and run the frontend tests.

use crate::validate::with_defaults;
use camilladsp_config::config::{
    BiquadComboParameters, BiquadParameters, ClipperParameters, ConvParameters, DelayParameters,
    DiffEqParameters, DitherParameters, Filter, GainParameters, GeneralNotchParams,
    LookaheadLimiterParameters, LoudnessParameters, NotchWidth, PeakingWidth, ShelfSteepness,
    VolumeParameters,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const FIXTURE: &str = include_str!("../../frontend/src/camilladsp/eval/fixtures/variants.json");

/// Subtypes the fixture does not need a case for, with the reason.
/// Raw and Wav both need a file, which the backend reads and sends as samples,
/// so the evaluator handles them alike; eval.test.ts covers that with Raw.
/// Dither is drawn flat whatever the subtype, so Flat stands in for all.
const NOT_NEEDED: &[(&str, &str)] = &[("Conv", "Raw"), ("Conv", "Wav"), ("Dither", "*")];

/// A parameter and whether this case sets it.
type Param = (&'static str, bool);

fn opt<T>(name: &'static str, value: &Option<T>) -> Param {
    (name, value.is_some())
}

/// The filter's type, its subtype if it has those, and its parameters that
/// may be left out, with whether they are set.
///
/// Everything is destructured without `..`, so that anything new in
/// camilladsp-config fails to compile here instead of going unnoticed.
/// Parameters that every case must have are matched with `_`. Alternatives in
/// an untagged enum, like a peaking filter's Q or bandwidth, count as
/// parameters too, so that the fixture has a case for each.
fn parameters(filter: &Filter) -> (&'static str, Option<&'static str>, Vec<Param>) {
    match filter {
        Filter::Conv {
            description: _,
            parameters,
        } => {
            let subtype = match parameters {
                // Private fields, so these cannot be destructured.
                ConvParameters::Raw(_) => "Raw",
                ConvParameters::Wav(_) => "Wav",
                ConvParameters::Values { values: _ } => "Values",
                ConvParameters::Dummy { length: _ } => "Dummy",
            };
            ("Conv", Some(subtype), vec![])
        }
        Filter::Biquad {
            description: _,
            parameters,
        } => {
            let notch = |width: &NotchWidth| match width {
                NotchWidth::Q { freq: _, q: _ } => vec![("q", true), ("bandwidth", false)],
                NotchWidth::Bandwidth {
                    freq: _,
                    bandwidth: _,
                } => vec![("q", false), ("bandwidth", true)],
            };
            let shelf = |steepness: &ShelfSteepness| match steepness {
                ShelfSteepness::Q {
                    freq: _,
                    q: _,
                    gain: _,
                } => vec![("q", true), ("slope", false)],
                ShelfSteepness::Slope {
                    freq: _,
                    slope: _,
                    gain: _,
                } => vec![("q", false), ("slope", true)],
            };
            let (subtype, params) = match parameters {
                BiquadParameters::Free {
                    a1: _,
                    a2: _,
                    b0: _,
                    b1: _,
                    b2: _,
                } => ("Free", vec![]),
                BiquadParameters::Highpass { freq: _, q: _ } => ("Highpass", vec![]),
                BiquadParameters::Lowpass { freq: _, q: _ } => ("Lowpass", vec![]),
                BiquadParameters::Peaking(width) => {
                    let params = match width {
                        PeakingWidth::Q {
                            freq: _,
                            q: _,
                            gain: _,
                        } => vec![("q", true), ("bandwidth", false)],
                        PeakingWidth::Bandwidth {
                            freq: _,
                            bandwidth: _,
                            gain: _,
                        } => vec![("q", false), ("bandwidth", true)],
                    };
                    ("Peaking", params)
                }
                BiquadParameters::Highshelf(steepness) => ("Highshelf", shelf(steepness)),
                BiquadParameters::HighshelfFO { freq: _, gain: _ } => ("HighshelfFO", vec![]),
                BiquadParameters::Lowshelf(steepness) => ("Lowshelf", shelf(steepness)),
                BiquadParameters::LowshelfFO { freq: _, gain: _ } => ("LowshelfFO", vec![]),
                BiquadParameters::HighpassFO { freq: _ } => ("HighpassFO", vec![]),
                BiquadParameters::LowpassFO { freq: _ } => ("LowpassFO", vec![]),
                BiquadParameters::Allpass(width) => ("Allpass", notch(width)),
                BiquadParameters::AllpassFO { freq: _ } => ("AllpassFO", vec![]),
                BiquadParameters::Bandpass(width) => ("Bandpass", notch(width)),
                BiquadParameters::Notch(width) => ("Notch", notch(width)),
                BiquadParameters::GeneralNotch(GeneralNotchParams {
                    freq_p: _,
                    freq_z: _,
                    q_p: _,
                    normalize_at_dc,
                }) => (
                    "GeneralNotch",
                    vec![opt("normalize_at_dc", normalize_at_dc)],
                ),
                BiquadParameters::LinkwitzTransform {
                    freq_act: _,
                    q_act: _,
                    freq_target: _,
                    q_target: _,
                } => ("LinkwitzTransform", vec![]),
            };
            ("Biquad", Some(subtype), params)
        }
        Filter::BiquadCombo {
            description: _,
            parameters,
        } => {
            let (subtype, params) = match parameters {
                BiquadComboParameters::LinkwitzRileyHighpass { freq: _, order: _ } => {
                    ("LinkwitzRileyHighpass", vec![])
                }
                BiquadComboParameters::LinkwitzRileyLowpass { freq: _, order: _ } => {
                    ("LinkwitzRileyLowpass", vec![])
                }
                BiquadComboParameters::ButterworthHighpass { freq: _, order: _ } => {
                    ("ButterworthHighpass", vec![])
                }
                BiquadComboParameters::ButterworthLowpass { freq: _, order: _ } => {
                    ("ButterworthLowpass", vec![])
                }
                BiquadComboParameters::Tilt { gain: _ } => ("Tilt", vec![]),
                BiquadComboParameters::NPointPeq { bands: _ } => ("NPointPeq", vec![]),
                // Private fields, so the optional freq_min and freq_max are
                // read back from the JSON instead.
                BiquadComboParameters::GraphicEqualizer(_) => {
                    let value = serde_json::to_value(parameters).unwrap();
                    let set = |name| !value[name].is_null();
                    (
                        "GraphicEqualizer",
                        vec![("freq_min", set("freq_min")), ("freq_max", set("freq_max"))],
                    )
                }
            };
            ("BiquadCombo", Some(subtype), params)
        }
        Filter::Delay {
            description: _,
            parameters:
                DelayParameters {
                    delay: _,
                    delay_unit: _,
                    subsample,
                },
        } => ("Delay", None, vec![opt("subsample", subsample)]),
        Filter::Gain {
            description: _,
            parameters:
                GainParameters {
                    gain: _,
                    inverted,
                    mute,
                    scale,
                },
        } => (
            "Gain",
            None,
            vec![
                opt("inverted", inverted),
                opt("mute", mute),
                opt("scale", scale),
            ],
        ),
        Filter::Volume {
            description: _,
            parameters:
                VolumeParameters {
                    ramp_time_ms,
                    fader: _,
                    limit,
                },
        } => (
            "Volume",
            None,
            vec![opt("ramp_time_ms", ramp_time_ms), opt("limit", limit)],
        ),
        Filter::Loudness {
            description: _,
            parameters:
                LoudnessParameters {
                    reference_level: _,
                    high_boost,
                    low_boost,
                    high_freq,
                    low_freq,
                    high_q,
                    low_q,
                    fader,
                    attenuate_mid,
                },
        } => (
            "Loudness",
            None,
            vec![
                opt("high_boost", high_boost),
                opt("low_boost", low_boost),
                opt("high_freq", high_freq),
                opt("low_freq", low_freq),
                opt("high_q", high_q),
                opt("low_q", low_q),
                opt("fader", fader),
                opt("attenuate_mid", attenuate_mid),
            ],
        ),
        Filter::Dither {
            description: _,
            parameters,
        } => {
            let subtype = match parameters {
                DitherParameters::None { bits: _ } => "None",
                DitherParameters::Flat {
                    bits: _,
                    amplitude: _,
                } => "Flat",
                DitherParameters::Highpass { bits: _ } => "Highpass",
                DitherParameters::Fweighted441 { bits: _ } => "Fweighted441",
                DitherParameters::FweightedLong441 { bits: _ } => "FweightedLong441",
                DitherParameters::FweightedShort441 { bits: _ } => "FweightedShort441",
                DitherParameters::Gesemann441 { bits: _ } => "Gesemann441",
                DitherParameters::Gesemann48 { bits: _ } => "Gesemann48",
                DitherParameters::Lipshitz441 { bits: _ } => "Lipshitz441",
                DitherParameters::LipshitzLong441 { bits: _ } => "LipshitzLong441",
                DitherParameters::Shibata441 { bits: _ } => "Shibata441",
                DitherParameters::ShibataHigh441 { bits: _ } => "ShibataHigh441",
                DitherParameters::ShibataLow441 { bits: _ } => "ShibataLow441",
                DitherParameters::Shibata48 { bits: _ } => "Shibata48",
                DitherParameters::ShibataHigh48 { bits: _ } => "ShibataHigh48",
                DitherParameters::ShibataLow48 { bits: _ } => "ShibataLow48",
                DitherParameters::Shibata882 { bits: _ } => "Shibata882",
                DitherParameters::ShibataLow882 { bits: _ } => "ShibataLow882",
                DitherParameters::Shibata96 { bits: _ } => "Shibata96",
                DitherParameters::ShibataLow96 { bits: _ } => "ShibataLow96",
                DitherParameters::Shibata192 { bits: _ } => "Shibata192",
                DitherParameters::ShibataLow192 { bits: _ } => "ShibataLow192",
            };
            ("Dither", Some(subtype), vec![])
        }
        Filter::DiffEq {
            description: _,
            parameters: DiffEqParameters { a, b },
        } => ("DiffEq", None, vec![opt("a", a), opt("b", b)]),
        // clip_limit and limit have serde defaults but are not options, so
        // these are checked by value against the JSON in `optional_values`.
        Filter::Clipper {
            description: _,
            parameters:
                ClipperParameters {
                    soft_clip,
                    clip_limit: _,
                },
        } => ("Clipper", None, vec![opt("soft_clip", soft_clip)]),
        Filter::LookaheadLimiter {
            description: _,
            parameters:
                LookaheadLimiterParameters {
                    limit: _,
                    attack: _,
                    attack_unit: _,
                    release: _,
                    release_unit: _,
                },
        } => ("LookaheadLimiter", None, vec![]),
    }
}

/// Parameters with a serde default that is not an option, so the parsed value
/// does not say whether the case set them. Read from the case's JSON.
fn optional_values(kind: &str, case: &Value) -> Vec<Param> {
    let set = |name| (name, case["parameters"].get(name).is_some());
    match kind {
        "Clipper" => vec![set("clip_limit")],
        "LookaheadLimiter" => vec![set("limit")],
        _ => vec![],
    }
}

/// The variant names of an internally tagged enum, from the error serde gives
/// for an unknown tag. This finds new filter types and subtypes even before
/// `parameters` lists them.
fn variant_names<T: DeserializeOwned + std::fmt::Debug>() -> Vec<String> {
    let err = serde_json::from_value::<T>(json!({"type": "\u{1}"})).unwrap_err();
    let message = err.to_string();
    let list = message
        .split_once("expected one of ")
        .or_else(|| message.split_once("expected "))
        .unwrap_or_else(|| panic!("no variant list in {message:?}"))
        .1;
    list.split(", ")
        .map(|name| name.trim_matches('`').to_string())
        .collect()
}

struct Case {
    id: String,
    filter: Value,
}

fn cases() -> Vec<Case> {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    fixture["variants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| Case {
            id: case["id"].as_str().unwrap().to_string(),
            filter: case["filter"].clone(),
        })
        .collect()
}

fn parse(case: &Case) -> Filter {
    serde_json::from_value(case.filter.clone())
        .unwrap_or_else(|err| panic!("{} does not parse: {err}", case.id))
}

#[test]
fn every_case_parses_and_defaults_match() {
    let cases = cases();
    let by_id: BTreeMap<_, _> = cases.iter().map(|case| (case.id.as_str(), case)).collect();
    let mut wrong = vec![];
    for case in &cases {
        parse(case);
        if case.id.ends_with("-defaults") {
            continue;
        }
        let defaults = by_id
            .get(format!("{}-defaults", case.id).as_str())
            .unwrap_or_else(|| panic!("{} has no -defaults twin", case.id));
        // with_defaults works on whole configs, so wrap the filter in one.
        let config = |filter: &Value| {
            json!({
                "devices": {
                    "samplerate": 48000,
                    "chunksize": 1024,
                    "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
                    "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
                },
                "filters": {"f": filter},
            })
        };
        let filled = &with_defaults(config(&case.filter))["filters"]["f"];
        if *filled != defaults.filter {
            wrong.push(format!("{}-defaults should be {filled}", case.id));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn every_type_and_subtype_has_a_case() {
    let not_needed = |kind: &str, subtype: &str| {
        NOT_NEEDED
            .iter()
            .any(|(k, s)| *k == kind && (*s == subtype || *s == "*"))
    };
    let covered: BTreeSet<(String, Option<String>)> = cases()
        .iter()
        .map(|case| {
            let (kind, subtype, _) = parameters(&parse(case));
            (kind.to_string(), subtype.map(str::to_string))
        })
        .collect();
    let subtypes = |kind: &str| match kind {
        "Conv" => Some(variant_names::<ConvParameters>()),
        "Biquad" => Some(variant_names::<BiquadParameters>()),
        "BiquadCombo" => Some(variant_names::<BiquadComboParameters>()),
        "Dither" => Some(variant_names::<DitherParameters>()),
        _ => None,
    };
    let mut missing = vec![];
    for kind in variant_names::<Filter>() {
        match subtypes(&kind) {
            Some(names) => {
                if names.iter().all(|s| not_needed(&kind, s))
                    && covered.iter().any(|(k, _)| *k == kind)
                {
                    continue;
                }
                for subtype in names {
                    if !not_needed(&kind, &subtype)
                        && !covered.contains(&(kind.clone(), Some(subtype.clone())))
                    {
                        missing.push(format!("{kind}-{subtype}"));
                    }
                }
            }
            None => {
                if !covered.iter().any(|(k, _)| *k == kind) {
                    missing.push(kind);
                }
            }
        }
    }
    assert!(
        missing.is_empty(),
        "no case in variants.json for {missing:?}"
    );
}

#[test]
fn every_optional_parameter_is_set_somewhere() {
    let mut seen: BTreeMap<String, bool> = BTreeMap::new();
    for case in cases() {
        let (kind, subtype, mut params) = parameters(&parse(&case));
        params.extend(optional_values(kind, &case.filter));
        let prefix = match subtype {
            Some(subtype) => format!("{kind}-{subtype}"),
            None => kind.to_string(),
        };
        for (name, set) in params {
            *seen.entry(format!("{prefix}.{name}")).or_default() |= set;
        }
    }
    let unset: Vec<_> = seen
        .into_iter()
        .filter(|(_, set)| !set)
        .map(|(name, _)| name)
        .collect();
    assert!(unset.is_empty(), "never set in variants.json: {unset:?}");
}
