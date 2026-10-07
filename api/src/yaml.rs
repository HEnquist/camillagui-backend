//! YAML text to and from the JSON values the frontend works with.

use serde_json::{Map, Number, Value};
use yaml_serde::Value as Yaml;

/// A parsed YAML document.
pub struct Parsed {
    pub value: Value,
    /// Where the document had NaN or infinity, which JSON cannot hold and
    /// CamillaDSP does not accept. Those values are null in `value`.
    pub nonfinite: Vec<String>,
}

pub fn nonfinite_message(paths: &[String]) -> String {
    format!(
        "The config contains NaN or infinity, which CamillaDSP does not accept: {}",
        paths.join(", ")
    )
}

pub struct YamlError {
    pub message: String,
    /// One-based line and column, if the error has a location.
    pub location: Option<(usize, usize)>,
}

impl std::fmt::Display for YamlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

pub fn parse(text: &str) -> Result<Parsed, YamlError> {
    let mut yaml: Yaml = yaml_serde::from_str(text).map_err(|err| YamlError {
        location: err.location().map(|l| (l.line(), l.column())),
        message: err.to_string(),
    })?;
    yaml.apply_merge().map_err(|err| YamlError {
        location: None,
        message: err.to_string(),
    })?;
    let mut nonfinite = Vec::new();
    let value = to_json(yaml, &mut Vec::new(), &mut nonfinite);
    Ok(Parsed { value, nonfinite })
}

fn key_string(key: Yaml) -> String {
    match key {
        Yaml::String(s) => s,
        Yaml::Null => "null".to_string(),
        Yaml::Bool(b) => b.to_string(),
        Yaml::Number(n) => n.to_string(),
        Yaml::Tagged(tagged) => key_string(tagged.value),
        other => yaml_serde::to_string(&other)
            .map(|s| s.trim_end().to_string())
            .unwrap_or_default(),
    }
}

fn to_json(yaml: Yaml, path: &mut Vec<String>, nonfinite: &mut Vec<String>) -> Value {
    match yaml {
        Yaml::Null => Value::Null,
        Yaml::Bool(b) => Value::Bool(b),
        Yaml::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                Value::Number(u.into())
            } else {
                match n.as_f64().and_then(Number::from_f64) {
                    Some(number) => Value::Number(number),
                    None => {
                        nonfinite.push(path.join("/"));
                        Value::Null
                    }
                }
            }
        }
        Yaml::String(s) => Value::String(s),
        Yaml::Sequence(items) => Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, item)| {
                    path.push(index.to_string());
                    let value = to_json(item, path, nonfinite);
                    path.pop();
                    value
                })
                .collect(),
        ),
        Yaml::Mapping(mapping) => {
            let mut map = Map::new();
            for (key, item) in mapping {
                let key = key_string(key);
                path.push(key.clone());
                let value = to_json(item, path, nonfinite);
                path.pop();
                map.insert(key, value);
            }
            Value::Object(map)
        }
        Yaml::Tagged(tagged) => to_json(tagged.value, path, nonfinite),
    }
}

/// Write a value as YAML. Keys come out sorted, the order a JSON object keeps them in.
pub fn dump(value: &Value) -> String {
    yaml_serde::to_string(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nonfinite_values_are_found() {
        let parsed = parse(
            "filters:\n  gain: {type: Gain, parameters: {gain: .nan}}\n  fir: {type: Conv, parameters: {type: Values, values: [1.0, -.inf]}}\n",
        )
        .ok()
        .unwrap();
        assert_eq!(
            parsed.nonfinite,
            vec![
                "filters/gain/parameters/gain",
                "filters/fir/parameters/values/1"
            ]
        );
        assert_eq!(
            parsed.value["filters"]["fir"]["parameters"]["values"],
            json!([1.0, null])
        );
    }

    #[test]
    fn integers_stay_integers() {
        let parsed = parse("devices: {samplerate: 44100, gain: -3.5, n: 1}\n")
            .ok()
            .unwrap();
        assert_eq!(
            parsed.value,
            json!({"devices": {"samplerate": 44100, "gain": -3.5, "n": 1}})
        );
        assert!(parsed.value["devices"]["samplerate"].is_u64());
    }

    #[test]
    fn merge_keys_are_applied() {
        let parsed = parse("base: &b {a: 1}\nderived:\n  <<: *b\n  c: 2\n")
            .ok()
            .unwrap();
        assert_eq!(parsed.value["derived"], json!({"a": 1, "c": 2}));
    }

    #[test]
    fn errors_have_a_location() {
        let err = parse("a: [1, 2\nb: 3\n").err().unwrap();
        assert!(err.location.is_some());
    }

    #[test]
    fn dump_round_trips() {
        let value = json!({"b": [1, 2.5, "x"], "a": null, "c": {"d": true}});
        let text = dump(&value);
        assert_eq!(parse(&text).ok().unwrap().value, value);
    }
}
