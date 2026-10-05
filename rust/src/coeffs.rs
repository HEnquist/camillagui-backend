//! Coefficient and wav files: reading them for the frontend's filter plots,
//! and describing them.

use camilladsp_config::ToF64;
use camilladsp_config::config::ConvParameters;
use camilladsp_config::filters::fftconv::coeffs_from_config;
use serde_json::{Map, Value, json};
use std::path::Path;

/// Sensible filter parameters for a coefficient file, from its extension.
pub fn defaults_for_filter(file_path: &str) -> Value {
    let extension = Path::new(file_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase());
    let format = match extension.as_deref() {
        Some("wav") => return json!({"type": "Wav"}),
        Some("txt" | "csv" | "tsv") => "TEXT",
        Some("dbl" | "f64") => "F64_LE",
        Some("raw" | "pcm" | "dat" | "sam" | "i32") => "S32_LE",
        Some("f32") => "F32_LE",
        Some("i24") => "S24_3_LE",
        Some("i16") => "S16_LE",
        _ => return json!({}),
    };
    json!({
        "type": "Raw",
        "format": format,
        "skip_bytes_lines": 0,
        "read_bytes_lines": 0,
    })
}

/// One piece of a coefficient file name with tokens in it.
enum Part {
    Literal(String),
    Samplerate,
    Channels,
}

fn parse_pattern(name: &str) -> Vec<Part> {
    let mut parts = Vec::new();
    let mut rest = name;
    loop {
        let next = [("$samplerate$", 0), ("$channels$", 1)]
            .iter()
            .filter_map(|(token, kind)| rest.find(token).map(|pos| (pos, *token, *kind)))
            .min_by_key(|(pos, _, _)| *pos);
        match next {
            Some((pos, token, kind)) => {
                if pos > 0 {
                    parts.push(Part::Literal(rest[..pos].to_string()));
                }
                parts.push(if kind == 0 {
                    Part::Samplerate
                } else {
                    Part::Channels
                });
                rest = &rest[pos + token.len()..];
            }
            None => {
                if !rest.is_empty() {
                    parts.push(Part::Literal(rest.to_string()));
                }
                return parts;
            }
        }
    }
}

/// Match the start of `text` against the pattern, like a regex match with
/// `(\d*)` for each token: digit runs are greedy and give back as needed.
fn match_pattern(parts: &[Part], text: &str, found: &mut Vec<(usize, String)>) -> bool {
    let Some((first, rest)) = parts.split_first() else {
        return true;
    };
    match first {
        Part::Literal(literal) => match text.strip_prefix(literal.as_str()) {
            Some(remaining) => match_pattern(rest, remaining, found),
            None => false,
        },
        Part::Samplerate | Part::Channels => {
            let kind = usize::from(matches!(first, Part::Channels));
            let digits = text.bytes().take_while(u8::is_ascii_digit).count();
            for len in (0..=digits).rev() {
                found.push((kind, text[..len].to_string()));
                if match_pattern(rest, &text[len..], found) {
                    return true;
                }
                found.pop();
            }
            false
        }
    }
}

/// The samplerate and channel variants of a coefficient file that exist, for
/// a file name that may have `$samplerate$` and `$channels$` tokens in it.
pub fn filter_plot_options(filter_file_names: &[String], filename: &str) -> Vec<Value> {
    let parts = parse_pattern(&crate::paths::basename(filename));
    let mut options = Vec::new();
    for file in filter_file_names {
        let mut found = Vec::new();
        if !match_pattern(&parts, file, &mut found) {
            continue;
        }
        let mut option = Map::new();
        option.insert("name".into(), json!(file));
        for (kind, digits) in found {
            let key = if kind == 0 { "samplerate" } else { "channels" };
            // An empty match is not a number. Python failed on it, here the
            // value is just left out.
            if let Ok(number) = digits.parse::<u64>() {
                option.insert(key.into(), json!(number));
            }
        }
        options.push(Value::Object(option));
    }
    options
}

/// Replace the tokens in the coefficient file path of a filter.
pub fn replace_tokens_in_filter(filter: &mut Value, samplerate: &Value, channels: &Value) {
    if !crate::paths::is_file_conv(filter) {
        return;
    }
    let as_text = |value: &Value| match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if let Some(Value::String(filename)) = filter["parameters"].get_mut("filename") {
        *filename = filename
            .replace("$samplerate$", &as_text(samplerate))
            .replace("$channels$", &as_text(channels));
    }
}

/// Source formats that hold no more precision than a float32, so sending one
/// as float32 is exact. F64_LE and S32_LE hold more, and a TEXT file can say
/// anything at all, so those go out as float64.
const FLOAT32_EXACT_FORMATS: [&str; 5] =
    ["F32_LE", "S16_LE", "S24_3_LE", "S24_4_RJ_LE", "S24_4_LJ_LE"];

/// Read the coefficients of a Conv filter that gets them from a file, the
/// same way CamillaDSP reads them. Returns whether they fit in float32 too.
pub fn read_coefficients(parameters: &Value) -> Result<(Vec<f64>, bool), String> {
    let conv: ConvParameters =
        serde_json::from_value(parameters.clone()).map_err(|err| err.to_string())?;
    let source_format = match &conv {
        ConvParameters::Wav(params) => crate::wav::read_info(Path::new(&params.filename))
            .map(|info| info.sample_format.to_string()),
        ConvParameters::Raw(params) => Some(format!("{:?}", params.format())),
        _ => None,
    };
    let fits_f32 = source_format.is_some_and(|f| FLOAT32_EXACT_FORMATS.contains(&f.as_str()));
    let values = coeffs_from_config(&conv).map_err(|err| err.to_string())?;
    Ok((values.into_iter().map(ToF64::to_f64).collect(), fits_f32))
}

/// Frame a coefficient set for the wire.
///
/// Not JSON. A million taps is 21.8 MB of decimal text that is slow to format
/// and to parse, where the same samples as raw floats are 8.4 MB or less and
/// free to read: the frontend takes a typed array view straight over the bytes.
///
/// The frame is a little endian u32 giving the length of a JSON header, that
/// header, padding to the next multiple of 8, and then the samples. The padding
/// lets the view be taken in place, since a Float64Array needs an offset it can
/// divide by 8. The header carries the samplerate and channel options, and
/// which width the samples are in.
pub fn frame_coefficients(options: &[Value], values: &[f64], as_f32: bool) -> Vec<u8> {
    let width = if as_f32 { "float32" } else { "float64" };
    let header = json!({"options": options, "format": width}).to_string();
    let padding = (8 - (4 + header.len()) % 8) % 8;
    let sample_bytes = if as_f32 { 4 } else { 8 };
    let mut body = Vec::with_capacity(4 + header.len() + padding + sample_bytes * values.len());
    body.extend_from_slice(&(header.len() as u32).to_le_bytes());
    body.extend_from_slice(header.as_bytes());
    body.resize(body.len() + padding, 0);
    for value in values {
        if as_f32 {
            body.extend_from_slice(&(*value as f32).to_le_bytes());
        } else {
            body.extend_from_slice(&value.to_le_bytes());
        }
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_from_tokens() {
        let files: Vec<String> = [
            "convtest_44100_2.f32",
            "convtest_48000_2.f32",
            "convtest_x_2.f32",
            "other.f32",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let options = filter_plot_options(&files, "convtest_$samplerate$_$channels$.f32");
        assert_eq!(
            options,
            vec![
                json!({"name": "convtest_44100_2.f32", "samplerate": 44100, "channels": 2}),
                json!({"name": "convtest_48000_2.f32", "samplerate": 48000, "channels": 2}),
            ]
        );
        let options = filter_plot_options(&files, "/some/where/other.f32");
        assert_eq!(options, vec![json!({"name": "other.f32"})]);
    }

    #[test]
    fn digit_runs_give_back() {
        let files = vec!["f_441002.raw".to_string()];
        let options = filter_plot_options(&files, "f_$samplerate$2.raw");
        assert_eq!(
            options,
            vec![json!({"name": "f_441002.raw", "samplerate": 44100})]
        );
    }

    #[test]
    fn frames_are_aligned() {
        let body = frame_coefficients(&[], &[0.5, -1.0], false);
        let header_len = u32::from_le_bytes(body[0..4].try_into().unwrap()) as usize;
        let start = 4 + header_len;
        let start = start + (8 - start % 8) % 8;
        assert_eq!(start % 8, 0);
        assert_eq!(body.len() - start, 16);
        assert_eq!(
            f64::from_le_bytes(body[start..start + 8].try_into().unwrap()),
            0.5
        );
    }

    #[test]
    fn defaults_by_extension() {
        assert_eq!(defaults_for_filter("x.WAV"), json!({"type": "Wav"}));
        assert_eq!(defaults_for_filter("x.f32")["format"], "F32_LE");
        assert_eq!(defaults_for_filter("x.unknown"), json!({}));
    }
}
