from os.path import basename


def filename_of_path(path: str) -> str:
    """
    Return just the filename from a full path.
    Accepts both Windows paths such as C:\temp\file.wav
    and Unix paths such as /tmp/file.wav
    """
    return basename(path.replace("\\", "/"))


def fraction_to_gain(fraction: str) -> float:
    if int(fraction) == 0:
        # Special case, n.0 means channel n with a linear gain of 1.0
        return 1.0
    # n.mmm means channel n with a linear gain of 0.mmm
    return float(f"0.{fraction}")


def parse_channel_and_fraction(channel: str, fraction: str) -> (int, float, bool):
    int_channel = abs(int(channel))
    gain = fraction_to_gain(fraction)
    inverted = channel.startswith("-")
    return (abs(int_channel), gain, inverted)


def channels_factors_and_inversions_as_list(
    channels_and_factors: str,
) -> list[tuple[int, float, bool]]:
    channels_and_fractions = [
        channel_and_fraction.split(".")
        for channel_and_fraction in channels_and_factors.split(" ")
    ]
    return [
        parse_channel_and_fraction(channel, fraction)
        for (channel, fraction) in channels_and_fractions
    ]


class Filter:
    filename: str
    channel: int
    channel_in_file: int
    input_channels: list[tuple[int, float, bool]]
    output_channels: list[tuple[int, float, bool]]

    def __init__(self, channel, filter_text: list[str]):
        self.channel = channel
        self.filename = filename_of_path(filter_text[0])
        self.channel_in_file = int(filter_text[1])
        self.input_channels = channels_factors_and_inversions_as_list(filter_text[2])
        self.output_channels = channels_factors_and_inversions_as_list(filter_text[3])

    def name(self) -> str:
        return self.filename + "-" + str(self.channel_in_file)


class ConvolverConfig:
    _samplerate: int
    _input_channels: int
    _output_channels: int
    _input_delays: list[int]
    _output_delays: list[int]
    _filters: list[Filter]

    def __init__(self, config_text: str):
        """
        :param config_text: a convolver config (https://convolver.sourceforge.net/config.html) as string
        """
        lines = config_text.splitlines()
        first_line_items = lines[0].split()
        self._samplerate = int(first_line_items[0])
        self._input_channels = int(first_line_items[1])
        self._output_channels = int(first_line_items[2])
        self._input_delays = [int(x) for x in lines[1].split()]
        self._output_delays = [int(x) for x in lines[2].split()]
        filter_lines = lines[3 : len(lines)]
        filter_count = int(len(filter_lines) / 4)
        self._filters = [
            Filter(n, filter_lines[n * 4 : n * 4 + 4]) for n in range(filter_count)
        ]

    def to_object(self) -> dict:
        return {
            "devices": {"samplerate": self._samplerate},
            "filters": self._delay_filter_definitions()
            | self._convolution_filter_definitions(),
            "mixers": self._mixer_in() | self._mixer_out(),
            "pipeline": self._input_delay_pipeline_steps()
            + self._mixer_in_pipeline_step()
            + self._filter_pipeline_steps()
            + self._mixer_out_pipeline_step()
            + self._output_delay_pipeline_steps(),
        }

    def _delay_filter_definitions(self) -> dict:
        delays = set(self._input_delays + self._output_delays)
        delays.remove(0)
        return {self._delay_name(delay): self._delay_filter(delay) for delay in delays}

    @staticmethod
    def _delay_name(delay: int) -> str:
        return "Delay" + str(delay)

    @staticmethod
    def _delay_filter(delay: int) -> dict:
        return {
            "type": "Delay",
            "parameters": {"delay": delay, "unit": "ms", "subsample": False},
        }

    def _convolution_filter_definitions(self) -> dict:
        return {
            f.name(): {
                "type": "Conv",
                "parameters": {
                    "type": "Wav",
                    "filename": f.filename,
                    "channel": f.channel_in_file,
                },
            }
            for f in self._filters
        }

    def _input_delay_pipeline_steps(self) -> list[dict]:
        return self._delay_pipeline_steps(self._input_delays)

    def _delay_pipeline_steps(self, delays: list[int]) -> list[dict]:
        return [
            {
                "type": "Filter",
                "channel": channel,
                "names": [self._delay_name(delay)],
                "bypassed": None,
                "description": None,
            }
            for channel, delay in enumerate(delays)
            if delay != 0
        ]

    def _output_delay_pipeline_steps(self) -> list[dict]:
        return self._delay_pipeline_steps(self._output_delays)

    def _mixer_in(self) -> dict:
        return {
            "Mixer in": {
                "channels": {
                    "in": self._input_channels,
                    "out": max(1, len(self._filters)),
                },
                "mapping": [
                    {
                        "dest": f.channel,
                        "sources": [
                            {
                                "channel": channel,
                                "gain": factor,
                                "scale": "linear",
                                "inverted": invert,
                            }
                            for (channel, factor, invert) in f.input_channels
                        ],
                    }
                    for f in self._filters
                ],
            }
        }

    def _mixer_out(self) -> dict:
        return {
            "Mixer out": {
                "channels": {
                    "in": max(1, len(self._filters)),
                    "out": self._output_channels,
                },
                "mapping": [
                    {
                        "dest": output_channel,
                        "sources": [
                            {
                                "channel": f.channel,
                                "gain": factor,
                                "scale": "linear",
                                "inverted": invert,
                            }
                            for f in self._filters
                            for (channel, factor, invert) in f.output_channels
                            if channel == output_channel
                        ],
                    }
                    for output_channel in range(self._output_channels)
                ],
            }
        }

    @staticmethod
    def _mixer_in_pipeline_step() -> list[dict]:
        return [{"type": "Mixer", "name": "Mixer in", "description": None}]

    @staticmethod
    def _mixer_out_pipeline_step() -> list[dict]:
        return [{"type": "Mixer", "name": "Mixer out", "description": None}]

    def _filter_pipeline_steps(self) -> list[dict]:
        return [
            {
                "type": "Filter",
                "channel": f.channel,
                "names": [f.name()],
                "bypassed": None,
                "description": None,
            }
            for f in self._filters
        ]
