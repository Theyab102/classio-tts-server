import base64
import hashlib
import hmac
import io
import json
import os
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from podcast_jobs import DialogueRequest, fingerprint, install_routes, pcm

SECRET = 'test-only-podcast-signing-secret-32-characters'

def payload():
    return {'language':'en','voices':['aria','echo'],'speed':1,'dialogue':[{'speaker':0,'text':'Energy is conserved. It changes form.'},{'speaker':1,'text':'How does a falling object transfer its energy?'}]}

def token(value, owner='a'*64, expiry=None):
    claim={'o':owner,'h':fingerprint(DialogueRequest(**value)),'exp':int(time.time())+600 if expiry is None else expiry}
    body=base64.urlsafe_b64encode(json.dumps(claim,separators=(',',':')).encode()).decode().rstrip('=')
    signature=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    return 'Bearer '+body+'.'+signature

def sound(text,voice,speed):
    rate=22050
    samples=np.sin(np.arange(round(rate*(0.18+len(text)/200)))*2*np.pi*(440 if voice=='aria' else 660)/rate)*0.8
    output=io.BytesIO()
    with wave.open(output,'wb') as stream:
        stream.setparams((1,2,rate,0,'NONE','not compressed'))
        stream.writeframes((samples*32767).astype('<i2').tobytes())
    return output.getvalue()

class PodcastJobTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.environment=patch.dict(os.environ,{'CLASSIO_TTS_SIGNING_SECRET':SECRET,'PODCAST_DATA_DIR':self.directory.name})
        self.environment.start()
        self.calls=[]
        def synthesize(text,voice,speed):
            self.calls.append((text,voice,speed))
            return sound(text,voice,speed)
        self.app=FastAPI()
        self.store=install_routes(self.app,synthesize)
        self.client=TestClient(self.app)
        self.addCleanup(self.environment.stop)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(lambda:self.store.executor.shutdown(wait=True))

    def finish(self, identity, headers):
        deadline=time.time()+10
        while time.time()<deadline:
            value=self.client.get('/podcasts/jobs/'+identity,headers=headers).json()
            if value['status'] in ('complete','failed'):return value
            time.sleep(.025)
        self.fail('Test audio job did not finish')

    def test_real_pcm_pipeline_produces_measured_captions_and_playable_audio(self):
        # Speech synthesis is a sine-wave test double. Assembly/PCM/AAC/HTTP are real.
        value=payload();headers={'Authorization':token(value)}
        response=self.client.post('/podcasts/jobs',json=value,headers=headers)
        self.assertEqual(response.status_code,202)
        job=self.finish(response.json()['id'],headers)
        self.assertEqual(job['status'],'complete')
        metadata=job['metadata']
        self.assertEqual([cue['speaker'] for cue in metadata['captions']],[0,0,1])
        self.assertEqual([voice for _,voice,_ in self.calls],['aria','aria','echo'])
        self.assertEqual(metadata['alignment'],'synthesized-phrase-boundaries')
        self.assertLess(metadata['peak'],.98)
        for previous,current in zip(metadata['captions'],metadata['captions'][1:]):self.assertGreaterEqual(current['start'],previous['end'])
        self.assertGreater(metadata['duration'],metadata['captions'][-1]['end'])
        self.assertTrue(any(metadata['envelope']))
        audio=self.client.get(job['audio'],headers=headers)
        self.assertEqual(audio.status_code,200)
        self.assertIn(audio.headers['content-type'],['audio/mp4','audio/wav'])
        self.assertEqual(audio.headers['cache-control'],'private, no-store')
        self.assertGreater(len(audio.content),1000)
        self.assertNotIn('filename',metadata)
        self.assertEqual(self.store.read(job['id'])['payload'],'{}')

    def test_identical_completed_request_reuses_audio_without_resynthesizing(self):
        value=payload();headers={'Authorization':token(value)}
        first=self.client.post('/podcasts/jobs',json=value,headers=headers).json()
        self.assertEqual(self.finish(first['id'],headers)['status'],'complete')
        second=self.client.post('/podcasts/jobs',json=value,headers=headers).json()
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(len(self.calls),3)

    def test_wrong_owner_expired_token_and_changed_script_are_rejected(self):
        value=payload();headers={'Authorization':token(value)}
        created=self.client.post('/podcasts/jobs',json=value,headers=headers).json()
        self.assertEqual(self.client.get('/podcasts/jobs/'+created['id'],headers={'Authorization':token(value,owner='b'*64)}).status_code,404)
        self.assertEqual(self.client.get('/podcasts/jobs/'+created['id']).status_code,401)
        self.assertEqual(self.client.get('/podcasts/jobs/'+created['id'],headers={'Authorization':token(value,expiry=int(time.time())-1)}).status_code,401)
        changed=payload();changed['dialogue'][0]['text']='A different script must have another ticket.'
        self.assertEqual(self.client.post('/podcasts/jobs',json=changed,headers=headers).status_code,403)

    def test_invalid_voice_language_and_dialogue_never_start_synthesis(self):
        valid=payload();headers={'Authorization':token(valid)}
        for change in [{'voices':['aria','aria']},{'voices':['unknown','echo']},{'language':'ar'},{'dialogue':[{'speaker':9,'text':'Invalid speaker'}]},{'speed':3},{'dialogue':[{'speaker':0,'text':'x'*1201}]}]:
            self.assertEqual(self.client.post('/podcasts/jobs',json={**valid,**change},headers=headers).status_code,422)
        self.assertEqual(self.calls,[])

    def test_generation_failures_keep_a_retryable_job_without_private_errors(self):
        self.store.synthesize=lambda *_:(_ for _ in ()).throw(RuntimeError('private model directory and credentials'))
        value=payload();headers={'Authorization':token(value)}
        created=self.client.post('/podcasts/jobs',json=value,headers=headers).json()
        result=self.finish(created['id'],headers)
        self.assertEqual(result['status'],'failed')
        self.assertNotIn('private',result['error'])
        self.assertEqual(self.client.get('/podcasts/jobs/'+created['id']+'/audio',headers=headers).status_code,409)
        self.store.synthesize=sound
        retried=self.client.post('/podcasts/jobs',json=value,headers=headers).json()
        self.assertEqual(self.finish(retried['id'],headers)['status'],'complete')

    def test_durable_queued_jobs_resume_from_sqlite(self):
        value=DialogueRequest(**payload());identity='c'*64
        with self.store.connect() as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)',(identity,'a'*64,fingerprint(value),'queued',value.model_dump_json(),0,2,None,None,time.time()))
        self.store.resume()
        result=self.finish(identity,{'Authorization':token(payload())})
        self.assertEqual(result['status'],'complete')

    def test_silent_segments_are_rejected_instead_of_creating_missing_speech(self):
        output=io.BytesIO()
        with wave.open(output,'wb') as stream:
            stream.setparams((1,2,22050,0,'NONE','not compressed'));stream.writeframes(b'\0\0'*2205)
        with self.assertRaisesRegex(ValueError,'silent'):pcm(output.getvalue())

    def test_fingerprint_matches_the_shared_javascript_canonical_format(self):
        value=payload();value['dialogue'][0]['text']=' Energy\n is\t conserved. '
        normalized=DialogueRequest(**value)
        expected='en\naria,echo\n100\n0:Energy is conserved.\n1:How does a falling object transfer its energy?'
        self.assertEqual(fingerprint(normalized),hashlib.sha256(expected.encode()).hexdigest())

    def test_unconfigured_signing_secret_fails_closed(self):
        with patch.dict(os.environ,{'CLASSIO_TTS_SIGNING_SECRET':''}):
            self.assertEqual(self.client.post('/podcasts/jobs',json=payload()).status_code,503)

if __name__=='__main__':unittest.main()
