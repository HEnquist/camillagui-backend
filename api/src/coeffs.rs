//! Coefficient and wav files: reading them for the frontend's filter plots,
//! and describing them.

use camilladsp_schema::ToF64;
use camilladsp_schema::config::{ConvParameters, FileSampleFormat};
use camilladsp_schema::filters::fftconv::coeffs_from_config;
use regex::{Captures, Regex};
use serde::Serialize;
use std::path::Path;
use utoipa::ToSchema;

/// The Conv filter subtypes that read a file.
#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub enum ConvFileType {
    Raw,
    Wav,
}

/// Sensible parameters for a Conv filter reading a coefficient file, from the
/// file's extension. Empty when the extension says nothing.
#[derive(Debug, Default, PartialEq, Serialize, ToSchema)]
pub struct CoeffDefaults {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub subtype: Option<ConvFileType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub format: Option<FileSampleFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub skip_bytes_lines: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub read_bytes_lines: Option<usize>,
}

/// Sensible filter parameters for a coefficient file, from its extension.
pub fn defaults_for_filter(file_path: &str) -> CoeffDefaults {
    let extension = Path::new(file_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase());
    let format = match extension.as_deref() {
        Some("wav") => {
            return CoeffDefaults {
                subtype: Some(ConvFileType::Wav),
                ..Default::default()
            };
        }
        Some("txt" | "csv" | "tsv") => FileSampleFormat::TEXT,
        Some("dbl" | "f64") => FileSampleFormat::F64_LE,
        Some("raw" | "pcm" | "dat" | "sam" | "i32") => FileSampleFormat::S32_LE,
        Some("f32") => FileSampleFormat::F32_LE,
        Some("i24") => FileSampleFormat::S24_3_LE,
        Some("i16") => FileSampleFormat::S16_LE,
        _ => return CoeffDefaults::default(),
    };
    CoeffDefaults {
        subtype: Some(ConvFileType::Raw),
        format: Some(format),
        skip_bytes_lines: Some(0),
        read_bytes_lines: Some(0),
    }
}

/// A variant of a coefficient file that exists, with the samplerate and
/// channels its name gives for the `$samplerate$` and `$channels$` tokens.
#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct FilterOption {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub samplerate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub channels: Option<u64>,
}

/// The samplerate and channel variants of a coefficient file that exist, for
/// a file name that may have `$samplerate$` and `$channels$` tokens in it.
pub fn filter_plot_options(filter_file_names: &[String], filename: &str) -> Vec<FilterOption> {
    let pattern = regex::escape(&crate::paths::basename(filename))
        .replace(r"\$samplerate\$", "(?<samplerate>[0-9]+)")
        .replace(r"\$channels\$", "(?<channels>[0-9]+)");
    // Fails only for a name with the same token twice, which nothing is named after.
    let Ok(pattern) = Regex::new(&format!("^{pattern}$")) else {
        return Vec::new();
    };
    let number = |captures: &Captures, token| {
        captures
            .name(token)
            .and_then(|digits| digits.as_str().parse().ok())
    };
    filter_file_names
        .iter()
        .filter_map(|file| {
            let captures = pattern.captures(file)?;
            Some(FilterOption {
                name: file.clone(),
                samplerate: number(&captures, "samplerate"),
                channels: number(&captures, "channels"),
            })
        })
        .collect()
}

/// Replace the tokens in a coefficient file path.
pub fn replace_tokens(filename: &str, samplerate: usize, channels: usize) -> String {
    filename
        .replace("$samplerate$", &samplerate.to_string())
        .replace("$channels$", &channels.to_string())
}

/// Source formats that hold no more precision than a float32, so sending one
/// as float32 is exact. F64_LE and S32_LE hold more, and a TEXT file can say
/// anything at all, so those go out as float64.
const FLOAT32_EXACT_FORMATS: [&str; 5] =
    ["F32_LE", "S16_LE", "S24_3_LE", "S24_4_RJ_LE", "S24_4_LJ_LE"];

/// Read the coefficients of a Conv filter that gets them from a file, the
/// same way CamillaDSP reads them. Returns whether they fit in float32 too.
pub fn read_coefficients(conv: &ConvParameters) -> Result<(Vec<f64>, bool), String> {
    let source_format = match conv {
        ConvParameters::Wav(params) => crate::wav::read_info(Path::new(&params.filename))
            .map(|info| info.sample_format.to_string()),
        ConvParameters::Raw(params) => Some(format!("{:?}", params.format())),
        _ => None,
    };
    let fits_f32 = source_format.is_some_and(|f| FLOAT32_EXACT_FORMATS.contains(&f.as_str()));
    let values = coeffs_from_config(conv).map_err(|err| err.to_string())?;
    Ok((values.into_iter().map(ToF64::to_f64).collect(), fits_f32))
}

/// The width of the samples in a coefficient frame.
#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SampleWidth {
    Float32,
    Float64,
}

/// The JSON header of a coefficient frame, see `frame_coefficients`.
#[derive(Serialize, ToSchema)]
pub struct CoeffsHeader {
    /// The variants of the file for other samplerates and channel counts.
    pub options: Vec<FilterOption>,
    pub format: SampleWidth,
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
pub fn frame_coefficients(options: Vec<FilterOption>, values: &[f64], as_f32: bool) -> Vec<u8> {
    let format = if as_f32 {
        SampleWidth::Float32
    } else {
        SampleWidth::Float64
    };
    let header =
        serde_json::to_string(&CoeffsHeader { options, format }).expect("the header serializes");
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
    use serde_json::{Value, json};

    fn as_json(value: impl Serialize) -> Value {
        serde_json::to_value(value).unwrap()
    }

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
            as_json(options),
            json!([
                {"name": "convtest_44100_2.f32", "samplerate": 44100, "channels": 2},
                {"name": "convtest_48000_2.f32", "samplerate": 48000, "channels": 2},
            ])
        );
        let options = filter_plot_options(&files, "/some/where/other.f32");
        assert_eq!(as_json(options), json!([{"name": "other.f32"}]));
    }

    #[test]
    fn digit_runs_give_back() {
        let files = vec!["f_441002.raw".to_string()];
        let options = filter_plot_options(&files, "f_$samplerate$2.raw");
        assert_eq!(
            as_json(options),
            json!([{"name": "f_441002.raw", "samplerate": 44100}])
        );
    }

    #[test]
    fn pattern_must_match_the_whole_name() {
        let files: Vec<String> = [
            "f_44100.raw",
            "f_44100.raw.bak",
            "f_.raw",
            "f_44100xraw",
            "other.f32.old",
            "eq (v2)+.f32",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let options = filter_plot_options(&files, "f_$samplerate$.raw");
        assert_eq!(
            as_json(options),
            json!([{"name": "f_44100.raw", "samplerate": 44100}])
        );
        let options = filter_plot_options(&files, "other.f32");
        assert!(options.is_empty());
        let options = filter_plot_options(&files, "eq (v2)+.f32");
        assert_eq!(as_json(options), json!([{"name": "eq (v2)+.f32"}]));
    }

    #[test]
    fn tokens_are_replaced() {
        assert_eq!(
            replace_tokens("f_$samplerate$_$channels$.raw", 48000, 2),
            "f_48000_2.raw"
        );
    }

    #[test]
    fn frames_are_aligned() {
        let body = frame_coefficients(Vec::new(), &[0.5, -1.0], false);
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
        assert_eq!(
            as_json(defaults_for_filter("x.WAV")),
            json!({"type": "Wav"})
        );
        assert_eq!(as_json(defaults_for_filter("x.f32"))["format"], "F32_LE");
        assert_eq!(as_json(defaults_for_filter("x.unknown")), json!({}));
    }
}
