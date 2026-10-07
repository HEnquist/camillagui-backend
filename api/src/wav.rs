//! Wav file headers.

use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use utoipa::ToSchema;
use waveadapter::SampleFormat;
use waveadapter::header::read_wav_header;

/// The header of a wav file.
#[derive(Debug, Serialize, ToSchema)]
pub struct WavInfo {
    #[serde(rename = "dataoffset")]
    pub data_offset: u64,
    #[serde(rename = "datalength")]
    pub data_length: u64,
    #[serde(rename = "sampleformat")]
    pub sample_format: &'static str,
    #[serde(rename = "bitspersample")]
    pub bits_per_sample: u16,
    pub channels: usize,
    #[serde(rename = "byterate")]
    pub byte_rate: u32,
    #[serde(rename = "samplerate")]
    pub sample_rate: usize,
    #[serde(rename = "bytesperframe")]
    pub bytes_per_frame: u16,
}

/// The CamillaDSP name of a wav sample format, if CamillaDSP can read it.
fn format_name(format: SampleFormat) -> Option<&'static str> {
    match format {
        SampleFormat::I16 => Some("S16_LE"),
        SampleFormat::I24_3 => Some("S24_3_LE"),
        SampleFormat::I24_4 => Some("S24_4_LJ_LE"),
        SampleFormat::I32 => Some("S32_LE"),
        SampleFormat::F32 => Some("F32_LE"),
        SampleFormat::F64 => Some("F64_LE"),
        _ => None,
    }
}

/// The header of a wav file, `None` if it is not one CamillaDSP can read.
pub fn read_info(path: &Path) -> Option<WavInfo> {
    let file = File::open(path).ok()?;
    let params = read_wav_header(BufReader::new(file)).ok()?;
    let sample_format = params.sample_format().and_then(format_name)?;
    Some(WavInfo {
        data_offset: params.data_offset,
        data_length: params.data_length,
        sample_format,
        bits_per_sample: params.fmt.bits_per_sample,
        channels: params.channels(),
        byte_rate: params.fmt.byte_rate,
        sample_rate: params.sample_rate(),
        bytes_per_frame: params.fmt.block_align,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(format_code: u16, bits: u16, channels: u16, frames: u32) -> Vec<u8> {
        let rate = 44100u32;
        let block_align = channels * bits / 8;
        let data_len = frames * block_align as u32;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&format_code.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * block_align as u32).to_le_bytes());
        out.extend_from_slice(&block_align.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        out.resize(out.len() + data_len as usize, 0);
        out
    }

    #[test]
    fn reads_a_float_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.wav");
        std::fs::write(&path, wav_bytes(3, 32, 2, 10)).unwrap();
        let info = read_info(&path).unwrap();
        assert_eq!(info.sample_format, "F32_LE");
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.data_offset, 44);
        assert_eq!(info.data_length, 80);
        assert_eq!(info.bytes_per_frame, 8);
        assert_eq!(info.byte_rate, 44100 * 8);
    }

    #[test]
    fn rejects_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.wav");
        std::fs::write(&path, b"not a wav file at all").unwrap();
        assert!(read_info(&path).is_none());
        assert!(read_info(&dir.path().join("missing.wav")).is_none());
    }
}
