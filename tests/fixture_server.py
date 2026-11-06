"""Synthetic speech fixture for local browser QA only. Never deploy this entry point."""
import os
import sys
import tempfile
from pathlib import Path
if os.environ.get('VERCEL') or os.environ.get('RENDER'):
    raise RuntimeError('The synthetic audio fixture must not run in production.')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['CLASSIO_TTS_SIGNING_SECRET']='test-only-podcast-signing-secret-32-characters'
os.environ['CLASSIO_ALLOWED_ORIGINS']='http://127.0.0.1:3000'
os.environ['PODCAST_DATA_DIR']=str(Path(tempfile.gettempdir())/'classio-podcast-qa-fixtures')
import io
import wave
import numpy as np
import server

def test_speech(text,voice,speed):
    rate=22050
    duration=1.6 if voice=='aria' else 2.2
    samples=.3*np.sin(2*np.pi*(440 if voice=='aria' else 660)*np.arange(round(rate*duration))/rate)
    data=io.BytesIO()
    with wave.open(data,'wb') as output:
        output.setparams((1,2,rate,0,'NONE','not compressed'))
        output.writeframes((samples*32767).astype('<i2').tobytes())
    return data.getvalue()
server.podcast_jobs.synthesize=test_speech
app=server.app
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8000)
