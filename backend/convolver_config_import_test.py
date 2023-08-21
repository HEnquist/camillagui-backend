from unittest import TestCase
from textwrap import dedent
from convolver_config_import import ConvolverConfig, filename_of_path, channels_factors_and_inversions_as_list


def clean_multi_line_string(multiline_text: str):
    """
    :param multiline_text:
    :return: the text without the first blank line and indentation
    """
    return dedent(multiline_text.removeprefix('\n'))


class Test(TestCase):

    def test_filename_of_path(self):
        self.assertEqual('File.wav', filename_of_path('File.wav'))
        self.assertEqual('File.wav', filename_of_path('/some/path/File.wav'))
        self.assertEqual('File.wav', filename_of_path('C:\\some\\path\\File.wav'))

    def test_channels_factors_and_inversions_as_list(self):
        self.assertEqual(
            channels_factors_and_inversions_as_list("0.0 1.1 -9.9 -0.0"),
            [(0, 0.0, False), (1, 0.1, False), (9, 0.9, True), (0, 0, True)]
        )

    def test_samplerate_is_imported(self):
        convolver_config = clean_multi_line_string("""
            96000 1 2 0
            0
            0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(json['devices'], {'samplerate': 96000})

    def test_delays_and_mixers_are_imported(self):
        convolver_config = clean_multi_line_string("""
            96000 2 3 0
            3
            0 4
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(
            json['filters'],
            {'Delay3': {'type': 'Delay', 'parameters': {'delay': 3, 'unit': 'ms', 'subsample': False}},
             'Delay4': {'type': 'Delay', 'parameters': {'delay': 4, 'unit': 'ms', 'subsample': False}}}
        )
        self.assertEqual(
            json['mixers']['Mixer in']['channels'],
            {'in': 2, 'out': 1}
        )
        self.assertEqual(
            json['mixers']['Mixer out']['channels'],
            {'in': 1, 'out': 3}
        )
        self.assertEqual(
            json['pipeline'],
            [{'type': 'Filter', 'channel': 0, 'names': ['Delay3'], 'bypassed': None, 'description': None},
             {'type': 'Mixer', 'name': 'Mixer in', 'description': None},
             {'type': 'Mixer', 'name': 'Mixer out', 'description': None},
             {'type': 'Filter', 'channel': 1, 'names': ['Delay4'], 'bypassed': None, 'description': None}]
        )

    def test_simple_impulse_response(self):
        convolver_config = clean_multi_line_string("""
            0 1 1 0
            0
            0
            IR.wav
            0
            0.0
            0.0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(
            json['filters'],
            {'IR.wav-0': {
                'type': 'Conv',
                'parameters': {'type': 'Wav', 'filename': 'IR.wav', 'channel': 0}}}
        )
        self.assertEqual(
            json['pipeline'],
            [{'type': 'Mixer', 'name': 'Mixer in', 'description': None},
             {'type': 'Filter', 'channel': 0, 'names': ['IR.wav-0'], 'bypassed': None, 'description': None},
             {'type': 'Mixer', 'name': 'Mixer out', 'description': None}]
        )

    def test_path_is_ignored_for_impulse_response_files(self):
        convolver_config = clean_multi_line_string("""
            0 1 1 0
            0
            0
            IR1.wav
            0
            0.0
            0.0
            C:\\any/path/IR2.wav
            0
            0.0
            0.0
            /some/other/path/IR3.wav
            0
            0.0
            0.0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(json['filters']['IR1.wav-0']['parameters']['filename'], 'IR1.wav')
        self.assertEqual(json['filters']['IR2.wav-0']['parameters']['filename'], 'IR2.wav')
        self.assertEqual(json['filters']['IR3.wav-0']['parameters']['filename'], 'IR3.wav')

    def test_wav_file_with_multiple_impulse_responses(self):
        convolver_config = clean_multi_line_string("""
            0 1 1 0
            0
            0
            IR.wav
            0
            0.0
            0.0
            IR.wav
            1
            0.0
            0.0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(json['filters']['IR.wav-0']['parameters']['channel'], 0)
        self.assertEqual(json['filters']['IR.wav-1']['parameters']['channel'], 1)

    def test_impulse_responses_are_mapped_to_correct_channels(self):
        convolver_config = clean_multi_line_string("""
            0 1 1 0
            0
            0
            IR1.wav
            0
            0.0
            0.0
            IR2.wav
            0
            0.0
            0.0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(
            json['pipeline'],
            [{'type': 'Mixer', 'name': 'Mixer in', 'description': None},
             {'type': 'Filter', 'channel': 0, 'names': ['IR1.wav-0'], 'bypassed': None, 'description': None},
             {'type': 'Filter', 'channel': 1, 'names': ['IR2.wav-0'], 'bypassed': None, 'description': None},
             {'type': 'Mixer', 'name': 'Mixer out', 'description': None}]
        )

    def test_impulse_response_with_input_scaling(self):
        convolver_config = clean_multi_line_string("""
            0 2 2 0
            0 0
            0 0
            IR.wav
            0
            0.0 1.1
            0.0
            IR.wav
            1
            0.2 1.3
            0.0
            IR.wav
            2
            -1.5 -0.4
            0.0
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(
            json['mixers']['Mixer in'],
            {'channels': {'in': 2, 'out': 3},
             'mapping': [
                 {'dest': 0,
                  'sources': [
                      {'channel': 0, 'gain': 0.0, 'scale': 'linear', 'inverted': False},
                      {'channel': 1, 'gain': 0.1, 'scale': 'linear', 'inverted': False}]},
                 {'dest': 1,
                  'sources': [
                      {'channel': 0, 'gain': 0.2, 'scale': 'linear', 'inverted': False},
                      {'channel': 1, 'gain': 0.3, 'scale': 'linear', 'inverted': False}]},
                 {'dest': 2,
                  'sources': [
                      {'channel': 1, 'gain': 0.5, 'scale': 'linear', 'inverted': True},
                      {'channel': 0, 'gain': 0.4, 'scale': 'linear', 'inverted': True}
                  ]},
             ]}
        )

    def test_impulse_response_with_output_scaling(self):
        convolver_config = clean_multi_line_string("""
            0 2 2 0
            0 0
            0 0
            IR.wav
            0
            0.0
            0.0 1.1
            IR.wav
            1
            0.0
            0.2 1.3
            IR.wav
            2
            0.0
            -1.5 -0.4
        """)
        json = ConvolverConfig(convolver_config).as_json()
        self.assertEqual(
            json['mixers']['Mixer out'],
            {'channels': {'in': 3, 'out': 2},
             'mapping': [
                 {'dest': 0,
                  'sources': [
                      {'channel': 0, 'gain': 0.0, 'scale': 'linear', 'inverted': False},
                      {'channel': 1, 'gain': 0.2, 'scale': 'linear', 'inverted': False},
                      {'channel': 2, 'gain': 0.4, 'scale': 'linear', 'inverted': True}]},
                 {'dest': 1,
                  'sources': [
                      {'channel': 0, 'gain': 0.1, 'scale': 'linear', 'inverted': False},
                      {'channel': 1, 'gain': 0.3, 'scale': 'linear', 'inverted': False},
                      {'channel': 2, 'gain': 0.5, 'scale': 'linear', 'inverted': True}]},
             ]}
        )
