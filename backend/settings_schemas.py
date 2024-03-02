BACKEND_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "camilla_host": {"type": "string", "minLength": 1},
        "camilla_port": {
            "type": "integer",
        },
        "bind_address": {"type": "string", "minLength": 1},
        "port": {
            "type": "integer",
        },
        "ssl_certificate": {"type": ["string", "null"], "minLength": 1},
        "ssl_private_key": {"type": ["string", "null"], "minLength": 1},
        "config_dir": {"type": "string", "minLength": 1},
        "coeff_dir": {"type": "string", "minLength": 1},
        "default_config": {"type": ["string", "null"], "minLength": 1},
        "statefile_path": {"type": ["string", "null"], "minLength": 1},
        "log_file": {"type": ["string", "null"], "minLength": 1},
        "on_set_active_config": {"type": ["string", "null"], "minLength": 1},
        "on_get_active_config": {"type": ["string", "null"], "minLength": 1},
        "supported_capture_types": {
            "type": ["array", "null"],
            "items": {"type": "string", "minLength": 1},
        },
        "supported_playback_types": {
            "type": ["array", "null"],
            "items": {"type": "string", "minLength": 1},
        },
    },
    "required": [
        "camilla_host",
        "camilla_port",
        "bind_address",
        "port",
        "config_dir",
        "coeff_dir",
    ],
}

GUI_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "hide_capture_samplerate": {"type": "boolean"},
        "hide_silence": {"type": "boolean"},
        "hide_capture_device": {"type": "boolean"},
        "hide_playback_device": {"type": "boolean"},
        "apply_config_automatically": {"type": "boolean"},
        "save_config_automatically": {"type": "boolean"},
        "status_update_interval": {"type": "integer", "minValue": 1},
        "custom_shortcuts": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "properties": {
                    "section": {"type": "string"},
                    "description": {"type": "string"},
                    "shortcuts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "path_in_config": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                                "range_from": {"type": "number"},
                                "range_to": {"type": "number"},
                                "step": {"type": "number"},
                            },
                            "required": [
                                "name",
                                "path_in_config",
                                "range_from",
                                "range_to",
                                "step",
                            ],
                        },
                    },
                },
                "required": ["section", "shortcuts"],
            },
        },
    },
    "required": [],
}

"""

custom_shortcuts:
  - section: "Equalizer"
    description: "To use the EQ, add filters named \"Bass\" and \"Treble\" to the pipeline.<br/>Recommented settings: <br/>Bass: Biquad Lowshelf freq=85 q=0.9<br/>Treble: Biquad Highshelf freq=6500 q=0.7"
    shortcuts:
      - name: "Treble (dB)"
        path_in_config: ["filters", "Treble", "parameters", "gain"]
        range_from: -12
        range_to: 12
        step: 0.5
      - name: "Bass (dB)"
        path_in_config: ["filters", "Bass", "parameters", "gain"]
        range_from: -12
        range_to: 12
        step: 0.5    
    
    
    """
