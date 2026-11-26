import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from server import app, _requests


class SpeechSecurityTests(unittest.TestCase):
    def setUp(self):
        _requests.clear()
        self.client = TestClient(app)

    def test_health_and_voice_catalog(self):
        self.assertEqual(self.client.get('/health').json(), {'status': 'healthy'})
        self.assertEqual(len(self.client.get('/voices').json()), 6)

    def test_validation_and_body_limit(self):
        with patch('server.synthesize_wav') as synthesis:
            self.assertEqual(self.client.post('/generate-podcast', json={'text':'hello there','voice':'../../private'}).status_code, 400)
            self.assertEqual(self.client.post('/generate-podcast', json={'text':'hello there','speed':20}).status_code, 422)
            self.assertEqual(self.client.post('/generate-podcast', content=b'x'*220001, headers={'content-type':'application/json'}).status_code, 413)
            synthesis.assert_not_called()

    def test_private_audio_is_not_cached_and_errors_are_sanitized(self):
        with patch('server.synthesize_wav', return_value=b'RIFF-test-fixture'):
            response=self.client.post('/generate-podcast',json={'text':'hello there'})
            self.assertEqual(response.headers['cache-control'],'no-store')
            self.assertEqual(response.headers['content-type'],'audio/wav')
        with patch('server.synthesize_wav', side_effect=RuntimeError('/private/model/path token-secret')):
            response=self.client.post('/generate-podcast',json={'text':'hello there'})
            self.assertEqual(response.status_code,503)
            self.assertNotIn('token-secret',response.text)
            self.assertNotIn('/private/',response.text)

    def test_public_generation_is_rate_limited(self):
        with patch('server.synthesize_wav', return_value=b'fixture') as synthesis:
            for _ in range(30):
                self.assertEqual(self.client.post('/generate-podcast',json={'text':'hello there'}).status_code,200)
            self.assertEqual(self.client.post('/generate-podcast',json={'text':'hello there'}).status_code,429)
            self.assertEqual(synthesis.call_count,30)

    def test_long_episode_and_immediate_voice_rebuild_fit_the_client_limit(self):
        with patch('server.synthesize_wav', return_value=b'RIFFwav') as synthesis:
            for voice in ['aria'] * 12 + ['nova'] * 12:
                self.assertEqual(self.client.post('/generate-podcast', json={'text':'A study explanation.', 'voice':voice}).status_code, 200)
            self.assertEqual(synthesis.call_count, 24)

    def test_browser_can_read_capacity_retry_header(self):
        with patch('server._generation_slots') as slots:
            slots.acquire.return_value = False
            response = self.client.post('/generate-podcast', json={'text': 'A clear explanation.'}, headers={'Origin': 'https://classio-eta.vercel.app'})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers['retry-after'], '10')
        self.assertEqual(response.headers['access-control-allow-origin'], 'https://classio-eta.vercel.app')
        self.assertIn('retry-after', response.headers.get('access-control-expose-headers', '').lower())

    def test_unknown_browser_origin_is_not_allowed(self):
        response=self.client.options('/generate-podcast',headers={'Origin':'https://untrusted.example','Access-Control-Request-Method':'POST'})
        self.assertNotIn('access-control-allow-origin',response.headers)


if __name__=='__main__':
    unittest.main()
