//! Import of Equalizer APO configs.

use serde_json::{Map, Value, json};

/// EqAPO filter types and their CamillaDSP Biquad names. IIR is not supported yet.
fn biquad_type(eqapo: &str) -> Option<&'static str> {
    Some(match eqapo {
        "PK" | "PEQ" => "Peaking",
        "HP" | "HPQ" => "Highpass",
        "LP" | "LPQ" => "Lowpass",
        "BP" => "Bandpass",
        "NO" => "Notch",
        "LS" | "LSC" => "Lowshelf",
        "HS" | "HSC" => "Highshelf",
        _ => return None,
    })
}

/// Channel labels to channel numbers, for a given number of channels.
fn channel_map(channels: i64) -> &'static [(&'static str, i64)] {
    match channels {
        1 => &[("C", 1)],
        2 => &[("L", 0), ("R", 1)],
        4 => &[("L", 0), ("R", 1), ("RL", 2), ("RR", 3)],
        6 => &[
            ("L", 0),
            ("R", 1),
            ("C", 2),
            ("LFE", 3),
            ("RL", 4),
            ("RR", 5),
        ],
        _ => &[
            ("L", 0),
            ("R", 1),
            ("C", 2),
            ("LFE", 3),
            ("RL", 4),
            ("RR", 5),
            ("SL", 6),
            ("SR", 7),
        ],
    }
}

/// Inline expressions are not supported, a value that is not a plain number is null.
fn parse_number(text: &str) -> Value {
    match text.parse::<f64>() {
        Ok(number) => json!(number),
        Err(_) => {
            log::warn!("Unable to parse '{text}' as number, inline expressions are not supported.");
            Value::Null
        }
    }
}

pub struct EqApo {
    channels: i64,
    filters: Map<String, Value>,
    mixers: Map<String, Value>,
    pipeline: Vec<Value>,
    selected_channels: Value,
    counters: [(&'static str, usize); 5],
}

impl EqApo {
    pub fn new(channels: i64) -> Self {
        EqApo {
            channels,
            filters: Map::new(),
            mixers: Map::new(),
            pipeline: vec![json!({
                "type": "Filter",
                "names": [],
                "description": "Default, all channels",
                "channels": null,
            })],
            selected_channels: Value::Null,
            counters: [
                ("Filter", 1),
                ("Preamp", 1),
                ("Convolution", 1),
                ("Delay", 1),
                ("Copy", 1),
            ],
        }
    }

    fn next_name(&mut self, command: &str) -> String {
        let counter = self
            .counters
            .iter_mut()
            .find(|(name, _)| *name == command)
            .expect("a known command");
        let name = format!("{command}_{}", counter.1);
        counter.1 += 1;
        name
    }

    fn lookup_channel_index(&self, label: &str) -> Value {
        if let Some((_, channel)) = channel_map(self.channels).iter().find(|(l, _)| *l == label) {
            return json!(channel);
        }
        if !label.is_empty() && label.chars().all(|c| c.is_ascii_digit()) {
            return label
                .parse::<i64>()
                .map(|n| json!(n - 1))
                .unwrap_or(Value::Null);
        }
        log::warn!("Virtual channels are not supported, skipping channel {label}");
        Value::Null
    }

    /// The parameters of a Filter command, `None` for unsupported types.
    fn parse_filter_params(&self, text: &str) -> Option<Map<String, Value>> {
        let tokens: Vec<&str> = text.split_whitespace().collect();
        let ftype = tokens.get(1)?;
        let Some(camilla_type) = biquad_type(ftype) else {
            log::warn!("Unsupported filter type '{ftype}'");
            return None;
        };
        let mut params = Map::new();
        params.insert("type".into(), json!(camilla_type));
        let mut rest = &tokens[2..];
        while let Some(first) = rest.first() {
            let (key, value, used) = match *first {
                "Fc" if unit_is(rest.get(2), "hz") => ("freq", rest.get(1), 3),
                "Q" => ("q", rest.get(1), 2),
                "Gain" if unit_is(rest.get(2), "db") => ("gain", rest.get(1), 3),
                "BW" if unit_is(rest.get(1), "oct") => ("bandwidth", rest.get(2), 3),
                "Fc" | "Gain" | "BW" => {
                    log::warn!("Invalid {first} parameter in: {text}");
                    return None;
                }
                other => {
                    log::warn!("Skipping unknown token: {other}");
                    rest = &rest[1..];
                    continue;
                }
            };
            let Some(value) = value else {
                log::warn!("Missing value for {first} in: {text}");
                return None;
            };
            params.insert(key.into(), parse_number(value));
            rest = &rest[used.min(rest.len())..];
        }
        apply_default_width(camilla_type, &mut params);
        Some(params)
    }

    fn parse_preamp(text: &str) -> Option<Value> {
        let tokens: Vec<&str> = text.split_whitespace().collect();
        if tokens.len() < 2 || tokens[1].to_lowercase() != "db" {
            log::warn!("invalid preamp line: {text}");
            return None;
        }
        Some(
            json!({"type": "Gain", "parameters": {"gain": parse_number(tokens[0]), "scale": "dB"}}),
        )
    }

    fn parse_delay(text: &str) -> Option<Value> {
        let tokens: Vec<&str> = text.split_whitespace().collect();
        let unit = match tokens.get(1) {
            Some(&"ms") => "ms",
            Some(&"samples") => "samples",
            _ => {
                log::warn!("invalid delay line: {text}");
                return None;
            }
        };
        Some(
            json!({"type": "Delay", "parameters": {"delay": parse_number(tokens[0]), "delay_unit": unit}}),
        )
    }

    /// A Copy command as a mixer. Channels it does not mention pass through.
    fn parse_copy(&self, text: &str) -> Map<String, Value> {
        let mut handled = Vec::new();
        let mut mapping = Vec::new();
        for item in text.trim().split(' ') {
            let Some((dest, expr)) = item.split_once('=').filter(|(_, e)| !e.contains('=')) else {
                log::warn!("Skipping invalid copy expression '{item}'");
                continue;
            };
            let dest = self.lookup_channel_index(dest);
            handled.push(dest.clone());
            let mut sources = Vec::new();
            for source in expr.split('+') {
                let (gain, scale, channel) = if let Some((gain, channel)) = source.split_once('*') {
                    match gain.strip_suffix("dB") {
                        Some(db) => (parse_number(db), "dB", channel),
                        None => (parse_number(gain), "linear", channel),
                    }
                } else if source == "0.0" {
                    // EqAPO can set a channel to a constant. Only 0.0 is
                    // supported, other values have no practical use.
                    continue;
                } else {
                    (json!(0), "dB", source)
                };
                sources.push(json!({
                    "channel": self.lookup_channel_index(channel),
                    "gain": gain,
                    "inverted": false,
                    "scale": scale,
                }));
            }
            mapping.push(json!({"dest": dest, "mute": false, "sources": sources}));
        }
        for dest in 0..self.channels.max(0) {
            if handled.contains(&json!(dest)) {
                continue;
            }
            mapping.push(json!({
                "dest": dest,
                "mute": false,
                "sources": [{"channel": dest, "gain": 0.0, "inverted": false, "scale": "dB"}],
            }));
        }
        let mut mixer = Map::new();
        mixer.insert(
            "channels".into(),
            json!({"in": self.channels, "out": self.channels}),
        );
        mixer.insert("mapping".into(), Value::Array(mapping));
        mixer
    }

    fn parse_line(&mut self, line: &str) {
        if line.is_empty() || line.starts_with('#') {
            return;
        }
        let Some((command_name, params)) = line.split_once(':') else {
            return;
        };
        let Some(command) = command_name.split_whitespace().next() else {
            return;
        };
        match command {
            "Filter" | "Convolution" | "Preamp" | "Delay" => {
                let filter = match command {
                    "Filter" => self
                        .parse_filter_params(params)
                        .map(|p| json!({"type": "Biquad", "parameters": p})),
                    "Convolution" => Some(json!({
                        "type": "Conv",
                        "parameters": {"filename": params.trim(), "type": "Wav"},
                    })),
                    "Preamp" => Self::parse_preamp(params),
                    _ => Self::parse_delay(params),
                };
                let Some(mut filter) = filter else {
                    return;
                };
                filter["description"] = json!(line.trim());
                let name = self.next_name(command);
                self.filters.insert(name.clone(), filter);
                if let Some(Value::Array(names)) =
                    self.pipeline.last_mut().and_then(|s| s.get_mut("names"))
                {
                    names.push(json!(name));
                }
            }
            "Channel" => {
                self.selected_channels = if params.trim() == "all" {
                    Value::Null
                } else {
                    Value::Array(
                        params
                            .trim()
                            .split(' ')
                            .map(|c| self.lookup_channel_index(c))
                            .collect(),
                    )
                };
                self.pipeline.push(json!({
                    "type": "Filter",
                    "names": [],
                    "description": line.trim(),
                    "channels": self.selected_channels,
                }));
            }
            "Copy" => {
                let mut mixer = self.parse_copy(params);
                mixer.insert("description".into(), json!(line.trim()));
                let name = self.next_name(command);
                self.mixers.insert(name.clone(), Value::Object(mixer));
                self.pipeline.push(json!({"type": "Mixer", "name": name}));
                self.pipeline.push(json!({
                    "type": "Filter",
                    "names": [],
                    "description": "Continued after mixer",
                    "channels": self.selected_channels,
                }));
            }
            "Device" | "Include" | "Eval" | "If" | "ElseIf" | "Else" | "EndIf" | "Stage"
            | "GraphicEQ" => {
                log::warn!("Command '{command}' is not supported, skipping.");
            }
            other => log::warn!("Skipping unrecognized command '{other}'"),
        }
    }

    fn postprocess(&mut self) {
        self.pipeline.retain(|step| {
            !(step["type"] == "Filter" && step["names"].as_array().is_some_and(Vec::is_empty))
        });
        for mixer in self.mixers.values_mut() {
            if let Some(Value::Array(mapping)) = mixer.get_mut("mapping") {
                mapping.retain(|dest| !dest["sources"].as_array().is_some_and(Vec::is_empty));
            }
        }
    }

    /// Translate a whole EqAPO config into a partial CamillaDSP config.
    pub fn translate(mut self, text: &str) -> Value {
        for line in text.lines() {
            self.parse_line(line);
        }
        self.postprocess();
        json!({
            "filters": self.filters,
            "mixers": self.mixers,
            "pipeline": self.pipeline,
        })
    }
}

/// Give a filter the width EqAPO uses when the line leaves it out, from
/// `BiQuadFilterFactory.cpp` in EqAPO. CamillaDSP has no such defaults.
/// Peaking filters get nothing, EqAPO refuses those without a width too.
fn apply_default_width(camilla_type: &str, params: &mut Map<String, Value>) {
    if matches!(camilla_type, "Lowshelf" | "Highshelf") {
        // EqAPO ignores a bandwidth for shelves.
        params.remove("bandwidth");
    }
    if params.contains_key("q") || params.contains_key("bandwidth") {
        return;
    }
    match camilla_type {
        "Lowpass" | "Highpass" | "Bandpass" => {
            params.insert("q".into(), json!(std::f64::consts::FRAC_1_SQRT_2));
        }
        // EqAPO's shelf slope S of 0.9, which CamillaDSP gives in dB per
        // octave with 12 dB as S = 1.
        "Lowshelf" | "Highshelf" => {
            params.insert("slope".into(), json!(0.9 * 12.0));
        }
        "Notch" => {
            params.insert("q".into(), json!(30.0));
        }
        _ => {}
    }
}

fn unit_is(token: Option<&&str>, unit: &str) -> bool {
    token.is_some_and(|t| t.to_lowercase() == unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = "
Device: High Definition Audio Device Speakers; Benchmark
#All lines below will only be applied to the specified device and the benchmark application
Preamp: -6 db
Include: example.txt
Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00
Filter  2: ON  PEQ      Fc     100 Hz  Gain   1.0 dB  BW Oct 0.167

Channel: L
#Additional preamp for left channel
Preamp: -5 dB
#Filters only for left channel
Include: demo.txt
Filter  1: ON  LS       Fc     300 Hz  Gain   5.0 dB

Channel: 2 C
#Filters for second(right) and center channel
Filter  1: ON  HP       Fc     30 Hz
Filter  2: ON  LPQ      Fc     10000 Hz  Q  0.400

Device: Microphone
#From here, the lines only apply to microphone devices
Filter: ON  NO       Fc     50 Hz
";

    #[test]
    fn single_filters() {
        let mut eqapo = EqApo::new(2);
        eqapo.parse_line("Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00");
        assert_eq!(
            eqapo.filters["Filter_1"]["parameters"],
            json!({"freq": 50.0, "gain": -3.0, "q": 10.0, "type": "Peaking"})
        );
        let mut eqapo = EqApo::new(2);
        eqapo.parse_line("Filter  2: ON  PEQ      Fc     100 Hz  Gain   1.0 dB  BW Oct 0.167");
        assert_eq!(
            eqapo.filters["Filter_1"]["parameters"],
            json!({"freq": 100.0, "gain": 1.0, "bandwidth": 0.167, "type": "Peaking"})
        );
    }

    #[test]
    fn example_translates() {
        let conf = EqApo::new(2).translate(EXAMPLE);
        assert_eq!(conf["filters"].as_object().unwrap().len(), 8);
        assert_eq!(
            conf["filters"]["Preamp_1"]["parameters"],
            json!({"gain": -6.0, "scale": "dB"})
        );
        assert_eq!(conf["pipeline"][1]["channels"], json!([0]));
        assert_eq!(conf["pipeline"][2]["channels"], json!([1, null]));
    }

    #[test]
    fn simple_conv() {
        let conf = EqApo::new(2)
            .translate("\nChannel: L\nConvolution: L.wav\nChannel: R\nConvolution: R.wav\n");
        assert_eq!(
            conf,
            json!({
                "filters": {
                    "Convolution_1": {"type": "Conv", "parameters": {"filename": "L.wav", "type": "Wav"}, "description": "Convolution: L.wav"},
                    "Convolution_2": {"type": "Conv", "parameters": {"filename": "R.wav", "type": "Wav"}, "description": "Convolution: R.wav"},
                },
                "mixers": {},
                "pipeline": [
                    {"type": "Filter", "names": ["Convolution_1"], "description": "Channel: L", "channels": [0]},
                    {"type": "Filter", "names": ["Convolution_2"], "description": "Channel: R", "channels": [1]},
                ],
            })
        );
    }

    #[test]
    fn filters_are_valid_for_camilladsp() {
        let text = format!("{EXAMPLE}\nConvolution: L.wav\nDelay: 2.5 ms\n");
        let conf = EqApo::new(2).translate(&text);
        let filters = conf["filters"].as_object().unwrap();
        assert_eq!(filters.len(), 10);
        for (name, filter) in filters {
            let parsed =
                serde_json::from_value::<camilladsp_config::config::Filter>(filter.clone());
            assert!(parsed.is_ok(), "{name}: {filter} {parsed:?}");
        }
    }

    #[test]
    fn widths_default_like_eqapo() {
        let params = |line: &str| {
            let mut eqapo = EqApo::new(2);
            eqapo.parse_line(line);
            eqapo.filters["Filter_1"]["parameters"].clone()
        };
        assert_eq!(params("Filter: ON LS Fc 300 Hz Gain 5 dB")["slope"], 10.8);
        assert_eq!(
            params("Filter: ON HSC Fc 3000 Hz Gain 2 dB Q 0.7")["q"],
            0.7
        );
        assert!(
            params("Filter: ON HS Fc 3000 Hz Gain 2 dB BW Oct 1")
                .get("bandwidth")
                .is_none()
        );
        assert_eq!(params("Filter: ON NO Fc 50 Hz")["q"], 30.0);
        assert_eq!(params("Filter: ON BP Fc 50 Hz Q 2")["q"], 2.0);
        assert!(
            params("Filter: ON PK Fc 50 Hz Gain 1 dB")
                .get("q")
                .is_none()
        );
    }

    #[test]
    fn crossover() {
        let text = "\nCopy: RL=L RR=R\nChannel: L R\nFilter  1: ON  LP       Fc     2000 Hz\nChannel: RL RR\nFilter  2: ON  HP       Fc     2000 Hz\n";
        let conf = EqApo::new(4).translate(text);
        let source =
            |channel: i64| json!({"channel": channel, "gain": 0, "inverted": false, "scale": "dB"});
        assert_eq!(
            conf,
            json!({
                "filters": {
                    "Filter_1": {"type": "Biquad", "parameters": {"type": "Lowpass", "freq": 2000.0, "q": std::f64::consts::FRAC_1_SQRT_2}, "description": "Filter  1: ON  LP       Fc     2000 Hz"},
                    "Filter_2": {"type": "Biquad", "parameters": {"type": "Highpass", "freq": 2000.0, "q": std::f64::consts::FRAC_1_SQRT_2}, "description": "Filter  2: ON  HP       Fc     2000 Hz"},
                },
                "mixers": {
                    "Copy_1": {
                        "channels": {"in": 4, "out": 4},
                        "mapping": [
                            {"dest": 2, "mute": false, "sources": [source(0)]},
                            {"dest": 3, "mute": false, "sources": [source(1)]},
                            {"dest": 0, "mute": false, "sources": [{"channel": 0, "gain": 0.0, "inverted": false, "scale": "dB"}]},
                            {"dest": 1, "mute": false, "sources": [{"channel": 1, "gain": 0.0, "inverted": false, "scale": "dB"}]},
                        ],
                        "description": "Copy: RL=L RR=R",
                    }
                },
                "pipeline": [
                    {"type": "Mixer", "name": "Copy_1"},
                    {"type": "Filter", "names": ["Filter_1"], "description": "Channel: L R", "channels": [0, 1]},
                    {"type": "Filter", "names": ["Filter_2"], "description": "Channel: RL RR", "channels": [2, 3]},
                ],
            })
        );
    }
}
