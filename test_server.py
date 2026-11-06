import hashlib
import io
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
import server


class SpeechServerTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_health_and_six_voice_descriptions(self):
        self.assertEqual(self.client.get('/health').json(), {'status': 'healthy'})
        self.assertEqual(len(self.client.get('/voices').json()), 6)

    def test_invalid_requests_never_start_synthesis(self):
        with patch.object(server, 'synthesize_wav') as synthesize:
            for payload in [{'text': 'x'}, {'text': 'Hello Classio', 'voice': 'unknown'}, {'text': 'Hello Classio', 'speed': 0}, {'text': 'x' * 50001}]:
                self.assertEqual(self.client.post('/generate-podcast', json=payload).status_code, 400)
            synthesize.assert_not_called()

    def test_http_audio_contract_with_a_test_double(self):
        # This tests the HTTP contract, not real Piper voice quality.
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as output:
            output.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
            output.writeframes(b'\x00\x00' * 2205)
        with patch.object(server, 'synthesize_wav', return_value=buffer.getvalue()):
            response = self.client.post('/generate-podcast', json={'text': 'Hello Classio', 'voice': 'echo'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['content-type'], 'audio/wav')
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        self.assertTrue(response.content.startswith(b'RIFF'))

    def test_internal_errors_are_not_returned_to_clients(self):
        with patch.object(server, 'synthesize_wav', side_effect=RuntimeError('private server credential detail')):
            response = self.client.post('/generate-podcast', json={'text': 'Hello Classio'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private server', response.text)

    def test_failed_model_pair_download_cannot_publish_partial_artifacts(self):
        payload = b'verified model bytes'
        expected = {'size_bytes': len(payload), 'md5_digest': hashlib.md5(payload).hexdigest()}
        paths = {'test.onnx': expected, 'test.onnx.json': expected}
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'MODELS_DIR', Path(directory)), patch.object(server, 'model_files', return_value=paths), patch.object(server.urllib.request, 'urlopen', side_effect=[io.BytesIO(payload), OSError('download failed')]):
            with self.assertRaises(OSError):
                server.ensure_model('aria')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_corrupt_model_download_fails_checksum_verification(self):
        expected = {'size_bytes': 7, 'md5_digest': hashlib.md5(b'correct').hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'MODELS_DIR', Path(directory)), patch.object(server, 'model_files', return_value={'test.onnx': expected}), patch.object(server.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt')):
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                server.ensure_model('aria')
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
