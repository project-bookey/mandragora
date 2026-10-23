"""Disposable local QA server; production uses Gunicorn and Nginx."""
import mimetypes
import os
from pathlib import Path
import sys
import tempfile
from wsgiref.simple_server import make_server

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT))
os.environ.setdefault('MANDRAGORA_DB',tempfile.mkdtemp(prefix='mandragora-qa-')+'/farm.sqlite3')
os.environ.setdefault('MANDRAGORA_ORIGIN','http://127.0.0.1:8322')
from server.app import application


def serve(env,start):
    path=env.get('PATH_INFO','/')
    if path.startswith('/mandragora/api/'):
        env['PATH_INFO']=path.removeprefix('/mandragora/api')
        return application(env,start)
    if path in ('/','/mandragora'):
        start('302 Found',[('Location','/mandragora/')]);return [b'']
    file=(ROOT/'dist'/path.removeprefix('/mandragora/')).resolve()
    if path=='/mandragora/':file=ROOT/'dist/index.html'
    if not file.is_relative_to(ROOT/'dist') or not file.is_file():
        start('404 Not Found',[]);return [b'not found']
    start('200 OK',[('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream'),('Cache-Control','no-store')])
    return [file.read_bytes()]


if __name__=='__main__':
    print('QA server: http://127.0.0.1:8322/mandragora/',flush=True)
    make_server('127.0.0.1',8322,serve).serve_forever()
