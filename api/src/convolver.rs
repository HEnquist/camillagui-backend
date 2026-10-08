//! Import of Convolver configs, see <https://convolver.sourceforge.net/config.html>.

use serde_json::{Map, Value, json};

/// Just the file name of a Windows or Unix path.
fn filename_of_path(path: &str) -> String {
    crate::paths::nt_basename(path).to_string()
}

/// `n.0` means channel n with a linear gain of 1.0, `n.mmm` a gain of 0.mmm.
fn fraction_to_gain(fraction: &str) -> Result<f64, String> {
    let as_int: i64 = fraction
        .parse()
        .map_err(|_| format!("Invalid channel fraction '{fraction}'"))?;
    if as_int == 0 {
        return Ok(1.0);
    }
    format!("0.{fraction}")
        .parse()
        .map_err(|_| format!("Invalid channel fraction '{fraction}'"))
}

/// A channel with its gain and whether it is inverted, from `-n.mmm`.
fn channels_factors_and_inversions(text: &str) -> Result<Vec<(i64, f64, bool)>, String> {
    text.split(' ')
        .map(|item| {
            let (channel, fraction) = item
                .split_once('.')
                .filter(|(_, fraction)| !fraction.contains('.'))
                .ok_or_else(|| format!("Invalid channel and factor '{item}'"))?;
            let number: i64 = channel
                .parse()
                .map_err(|_| format!("Invalid channel '{channel}'"))?;
            Ok((
                number.abs(),
                fraction_to_gain(fraction)?,
                channel.starts_with('-'),
            ))
        })
        .collect()
}

struct Filter {
    filename: String,
    channel: usize,
    channel_in_file: i64,
    input_channels: Vec<(i64, f64, bool)>,
    output_channels: Vec<(i64, f64, bool)>,
}

impl Filter {
    fn new(channel: usize, lines: &[&str]) -> Result<Self, String> {
        Ok(Filter {
            channel,
            filename: filename_of_path(lines[0]),
            channel_in_file: parse_int(lines[1].trim())?,
            input_channels: channels_factors_and_inversions(lines[2])?,
            output_channels: channels_factors_and_inversions(lines[3])?,
        })
    }

    fn name(&self) -> String {
        format!("{}-{}", self.filename, self.channel_in_file)
    }
}

fn parse_int(text: &str) -> Result<i64, String> {
    text.parse().map_err(|_| format!("Invalid number '{text}'"))
}

fn parse_ints(line: Option<&&str>) -> Result<Vec<i64>, String> {
    line.ok_or("The config is too short")?
        .split_whitespace()
        .map(parse_int)
        .collect()
}

fn filter_step(channel: usize, name: String) -> Value {
    json!({
        "type": "Filter",
        "channels": [channel],
        "names": [name],
        "bypassed": null,
        "description": null,
    })
}

fn mixer_mapping(sources: &[(i64, f64, bool)], dest: i64) -> Value {
    let sources: Vec<Value> = sources
        .iter()
        .map(|(channel, gain, inverted)| {
            json!({"channel": channel, "gain": gain, "scale": "linear", "inverted": inverted})
        })
        .collect();
    json!({"dest": dest, "sources": sources})
}

fn mixer_step(name: &str) -> Value {
    json!({"type": "Mixer", "name": name, "description": null})
}

fn delay_name(delay: i64) -> String {
    format!("Delay{delay}")
}

/// Translate a Convolver config to a CamillaDSP config.
pub fn translate(text: &str) -> Result<Value, String> {
    let lines: Vec<&str> = text.lines().collect();
    let first = parse_ints(lines.first())?;
    let [samplerate, input_channels, output_channels, ..] = first[..] else {
        return Err("The first line needs the samplerate and the channel counts".to_string());
    };
    let input_delays = parse_ints(lines.get(1))?;
    let output_delays = parse_ints(lines.get(2))?;
    let filter_lines = lines.get(3..).unwrap_or_default();
    let filters = filter_lines
        .as_chunks::<4>()
        .0
        .iter()
        .enumerate()
        .map(|(n, chunk)| Filter::new(n, chunk))
        .collect::<Result<Vec<_>, _>>()?;

    let mut filter_defs = Map::new();
    for delay in input_delays.iter().chain(&output_delays) {
        if *delay != 0 {
            filter_defs.insert(
                delay_name(*delay),
                json!({
                    "type": "Delay",
                    "parameters": {"delay": delay, "delay_unit": "ms", "subsample": false},
                }),
            );
        }
    }
    for filter in &filters {
        filter_defs.insert(
            filter.name(),
            json!({
                "type": "Conv",
                "parameters": {"type": "Wav", "filename": filter.filename, "channel": filter.channel_in_file},
            }),
        );
    }

    let routed = filters.len().max(1);
    let mixer_in = json!({
        "channels": {"in": input_channels, "out": routed},
        "mapping": filters
            .iter()
            .map(|f| mixer_mapping(&f.input_channels, f.channel as i64))
            .collect::<Vec<_>>(),
    });
    let mixer_out = json!({
        "channels": {"in": routed, "out": output_channels},
        "mapping": (0..output_channels.max(0))
            .map(|output| {
                let sources: Vec<(i64, f64, bool)> = filters
                    .iter()
                    .flat_map(|f| {
                        f.output_channels
                            .iter()
                            .filter(move |(channel, _, _)| *channel == output)
                            .map(move |(_, gain, inverted)| (f.channel as i64, *gain, *inverted))
                    })
                    .collect();
                mixer_mapping(&sources, output)
            })
            .collect::<Vec<_>>(),
    });

    let delay_steps = |delays: &[i64]| -> Vec<Value> {
        delays
            .iter()
            .enumerate()
            .filter(|(_, delay)| **delay != 0)
            .map(|(channel, delay)| filter_step(channel, delay_name(*delay)))
            .collect()
    };
    let mut pipeline = delay_steps(&input_delays);
    pipeline.push(mixer_step("Mixer in"));
    pipeline.extend(filters.iter().map(|f| filter_step(f.channel, f.name())));
    pipeline.push(mixer_step("Mixer out"));
    pipeline.extend(delay_steps(&output_delays));

    Ok(json!({
        "devices": {"samplerate": samplerate},
        "filters": filter_defs,
        "mixers": {"Mixer in": mixer_in, "Mixer out": mixer_out},
        "pipeline": pipeline,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_and_factors() {
        assert_eq!(filename_of_path("C:\\some\\path\\File.wav"), "File.wav");
        assert_eq!(filename_of_path("/some/path/File.wav"), "File.wav");
        assert_eq!(
            channels_factors_and_inversions("0.0 1.1 -9.9").unwrap(),
            vec![(0, 1.0, false), (1, 0.1, false), (9, 0.9, true)]
        );
        assert_eq!(
            channels_factors_and_inversions("-0.0 -0.99999").unwrap(),
            vec![(0, 1.0, true), (0, 0.99999, true)]
        );
    }

    #[test]
    fn delays_and_mixers() {
        let conf = translate("96000 2 3 0\n3\n0 4\n").unwrap();
        assert_eq!(conf["devices"], json!({"samplerate": 96000}));
        assert_eq!(
            conf["filters"],
            json!({
                "Delay3": {"type": "Delay", "parameters": {"delay": 3, "delay_unit": "ms", "subsample": false}},
                "Delay4": {"type": "Delay", "parameters": {"delay": 4, "delay_unit": "ms", "subsample": false}},
            })
        );
        assert_eq!(
            conf["mixers"]["Mixer in"]["channels"],
            json!({"in": 2, "out": 1})
        );
        assert_eq!(
            conf["mixers"]["Mixer out"]["channels"],
            json!({"in": 1, "out": 3})
        );
        assert_eq!(
            conf["pipeline"],
            json!([
                {"type": "Filter", "channels": [0], "names": ["Delay3"], "bypassed": null, "description": null},
                {"type": "Mixer", "name": "Mixer in", "description": null},
                {"type": "Mixer", "name": "Mixer out", "description": null},
                {"type": "Filter", "channels": [1], "names": ["Delay4"], "bypassed": null, "description": null},
            ])
        );
    }

    #[test]
    fn input_scaling() {
        let text = "0 2 2 0\n0 0\n0 0\nIR.wav\n0\n0.0 1.1\n0.0\nIR.wav\n1\n0.2 1.3\n0.0\nIR.wav\n2\n-1.5 -0.4\n0.0\n";
        let conf = translate(text).unwrap();
        let src = |channel: i64, gain: f64, inverted: bool| json!({"channel": channel, "gain": gain, "scale": "linear", "inverted": inverted});
        assert_eq!(
            conf["mixers"]["Mixer in"],
            json!({
                "channels": {"in": 2, "out": 3},
                "mapping": [
                    {"dest": 0, "sources": [src(0, 1.0, false), src(1, 0.1, false)]},
                    {"dest": 1, "sources": [src(0, 0.2, false), src(1, 0.3, false)]},
                    {"dest": 2, "sources": [src(1, 0.5, true), src(0, 0.4, true)]},
                ],
            })
        );
        assert_eq!(conf["filters"]["IR.wav-2"]["parameters"]["channel"], 2);
    }

    #[test]
    fn output_scaling() {
        let text = "0 2 2 0\n0 0\n0 0\nIR.wav\n0\n0.0\n0.0 1.1\nIR.wav\n1\n0.0\n0.2 1.3\nIR.wav\n2\n0.0\n-1.5 -0.4\n";
        let conf = translate(text).unwrap();
        let src = |channel: i64, gain: f64, inverted: bool| json!({"channel": channel, "gain": gain, "scale": "linear", "inverted": inverted});
        assert_eq!(
            conf["mixers"]["Mixer out"],
            json!({
                "channels": {"in": 3, "out": 2},
                "mapping": [
                    {"dest": 0, "sources": [src(0, 1.0, false), src(1, 0.2, false), src(2, 0.4, true)]},
                    {"dest": 1, "sources": [src(0, 0.1, false), src(1, 0.3, false), src(2, 0.5, true)]},
                ],
            })
        );
    }

    #[test]
    fn bad_input_is_an_error() {
        assert!(translate("").is_err());
        assert!(translate("x y z\n0\n0\n").is_err());
    }
}
