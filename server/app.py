"""An anonymous, shared mandrake farm. Contents stay secret until a single harvest."""
from contextlib import contextmanager
import hashlib
from http import HTTPStatus
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

DB=os.environ.get('MANDRAGORA_DB','/var/lib/mandragora/farm.sqlite3')
ORIGIN=os.environ.get('MANDRAGORA_ORIGIN','https://www.bookey.site')
GROW_SECONDS=10
COOKIE='mandragora_gardener'
MOODS=('secret','cheer','silly')

class Error(Exception):
    def __init__(self,message,status=400):self.message,self.status=message,status

@contextmanager
def connect():
    db=sqlite3.connect(DB,timeout=15)
    db.row_factory=sqlite3.Row
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback();raise
    finally:db.close()

def init():
    Path(DB).parent.mkdir(parents=True,exist_ok=True)
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS plants (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL,
          mood TEXT NOT NULL, created REAL NOT NULL, ready REAL NOT NULL,
          harvested REAL, reader TEXT, thanked INTEGER NOT NULL DEFAULT 0,
          reported INTEGER NOT NULL DEFAULT 0, request_id TEXT NOT NULL,
          UNIQUE(owner,request_id));
        CREATE INDEX IF NOT EXISTS plants_available ON plants(harvested,created);
        CREATE INDEX IF NOT EXISTS plants_owner ON plants(owner,created);
        CREATE INDEX IF NOT EXISTS plants_reader ON plants(reader,harvested);
        CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires REAL NOT NULL);
        ''')
    os.chmod(DB,0o600)

def identity(env):
    c=SimpleCookie()
    try:c.load(env.get('HTTP_COOKIE',''))
    except Exception:pass
    token=c[COOKIE].value if COOKIE in c else ''
    is_new=not re.fullmatch(r'[A-Za-z0-9_-]{43}',token)
    if is_new:token=secrets.token_urlsafe(32)
    hashed=hashlib.sha256(token.encode()).hexdigest()
    cookie=f'{COOKIE}={token}; Path=/mandragora/; Max-Age=15552000; HttpOnly; Secure; SameSite=Strict'
    return hashed,[('Set-Cookie',cookie)] if is_new else []

def limit(key,maximum,seconds):
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM limits WHERE expires<?',(time.time(),))
        db.execute('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',(key,time.time()+seconds))
        count=db.execute('SELECT count FROM limits WHERE key=?',(key,)).fetchone()[0]
    if count>maximum:raise Error('밭을 잠시 쉬게 해주세요. 조금 뒤 다시 만나요.',429)

def note(row):
    return dict(id=row['id'],body=row['body'],mood=row['mood'],created=row['created']*1000,
                harvested=row['harvested']*1000 if row['harvested'] else None,thanked=bool(row['thanked']),reported=bool(row['reported']))

def snapshot(db,owner):
    # Public cells never contain a body, owner identifier, or recipient identifier.
    rows=db.execute('SELECT id,mood,created,ready,owner FROM plants WHERE harvested IS NULL AND reported=0 ORDER BY created LIMIT 36').fetchall()
    return dict(now=time.time()*1000,
      plots=[dict(id=r['id'],mood=r['mood'],created=r['created']*1000,readyAt=r['ready']*1000,mine=r['owner']==owner) for r in rows],
      stats=dict(waiting=db.execute('SELECT COUNT(*) FROM plants WHERE harvested IS NULL AND reported=0').fetchone()[0],
                 harvested=db.execute('SELECT COUNT(*) FROM plants WHERE harvested IS NOT NULL').fetchone()[0],
                 planted=db.execute('SELECT COUNT(*) FROM plants WHERE owner=?',(owner,)).fetchone()[0],
                 received=db.execute('SELECT COUNT(*) FROM plants WHERE reader=?',(owner,)).fetchone()[0],
                 thanks=db.execute('SELECT COALESCE(SUM(thanked),0) FROM plants WHERE owner=?',(owner,)).fetchone()[0]),
      planted=[note(r) for r in db.execute('SELECT * FROM plants WHERE owner=? ORDER BY created DESC LIMIT 50',(owner,))],
      basket=[note(r) for r in db.execute('SELECT * FROM plants WHERE reader=? ORDER BY harvested DESC LIMIT 50',(owner,))])

def dispatch(env,path,method,data):
    if path=='/health' and method=='GET':
        with connect() as db:db.execute('SELECT 1 FROM plants LIMIT 1').fetchone()
        return {'status':'ok','service':'mandragora'},[]
    owner,cookie=identity(env)
    if method=='POST':
        # Require the browser cookie established by the initial farm visit.
        if cookie:raise Error('먼저 농장에 들러주세요. 화면을 새로 열어주세요.',401)
        ip=env.get('HTTP_X_REAL_IP',env.get('REMOTE_ADDR','unknown'))
        limit('writes:'+owner,90,60)
        if path=='/plant':limit('plant-ip:'+ip,30,3600)
        elif path=='/harvest':limit('harvest-ip:'+ip,90,3600)
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        extra={}
        if path=='/plant' and method=='POST':
            body,mood,rid=data.get('body'),data.get('mood'),data.get('requestId')
            if not isinstance(body,str) or not 1<=len(body.strip())<=280:raise Error('1~280자 사이의 말을 심어주세요.')
            if mood not in MOODS or not isinstance(rid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}',rid):raise Error('씨앗을 다시 골라주세요.')
            previous=db.execute('SELECT id FROM plants WHERE owner=? AND request_id=?',(owner,rid)).fetchone()
            if previous:extra['plantedId']=previous['id']
            else:
                pid=secrets.token_hex(12);now=time.time()
                db.execute('INSERT INTO plants(id,owner,body,mood,created,ready,request_id) VALUES(?,?,?,?,?,?,?)',
                           (pid,owner,body.strip(),mood,now,now+GROW_SECONDS,rid))
                extra['plantedId']=pid
        elif path=='/harvest' and method=='POST':
            pid=data.get('id')
            if not isinstance(pid,str) or len(pid)!=24:raise Error('만드라고라를 골라주세요.')
            plant=db.execute('SELECT * FROM plants WHERE id=?',(pid,)).fetchone()
            if not plant or plant['reported']:raise Error('다른 농부가 먼저 뽑았어요. 다른 잎사귀를 골라봐요.',409)
            if plant['harvested']:
                if plant['reader']==owner:extra['harvest']=note(plant)
                else:raise Error('다른 농부가 먼저 뽑았어요. 다른 잎사귀를 골라봐요.',409)
            else:
                if plant['owner']==owner:raise Error('내가 심은 말은 다른 농부에게 맡겨두어요.',403)
                if plant['ready']>time.time():raise Error('아직 뿌리를 내리는 중이에요. 조금만 기다려주세요.',409)
                db.execute('UPDATE plants SET harvested=?,reader=? WHERE id=?',(time.time(),owner,pid))
                extra['harvest']=note(db.execute('SELECT * FROM plants WHERE id=?',(pid,)).fetchone())
        elif path in ('/thanks','/report') and method=='POST':
            pid=data.get('id')
            if not isinstance(pid,str):raise Error('만드라고라를 골라주세요.')
            plant=db.execute('SELECT * FROM plants WHERE id=? AND reader=?',(pid,owner)).fetchone()
            if not plant:raise Error('내 바구니의 말만 확인할 수 있어요.',403)
            column='thanked' if path=='/thanks' else 'reported'
            db.execute('UPDATE plants SET '+column+'=1 WHERE id=?',(pid,))
        elif path!='/farm' or method!='GET':raise Error('이 길에는 밭이 없어요.',404)
        return {**snapshot(db,owner),**extra},cookie

def application(env,start):
    try:
        method,path=env.get('REQUEST_METHOD','GET'),env.get('PATH_INFO','/')
        data={}
        if method not in ('GET','POST'):raise Error('지원하지 않는 요청이에요.',405)
        if method=='POST':
            if env.get('HTTP_ORIGIN')!=ORIGIN or env.get('HTTP_X_MANDRAGORA')!='1':raise Error('농장에서 다시 시도해주세요.',403)
            if env.get('CONTENT_TYPE','').split(';')[0]!='application/json':raise Error('씨앗의 모양을 확인해주세요.',415)
            length=int(env.get('CONTENT_LENGTH') or 0)
            if not 0<length<=8192:raise Error('너무 큰 씨앗이에요.',413)
            data=json.loads(env['wsgi.input'].read(length))
            if not isinstance(data,dict):raise Error('내용을 다시 확인해주세요.')
        result,headers=dispatch(env,path,method,data);status=200
    except Error as e:result,headers,status={'error':e.message},[],e.status
    except (ValueError,TypeError,KeyError):result,headers,status={'error':'내용을 다시 확인해주세요.'},[],400
    except Exception:
        import traceback;traceback.print_exc()
        result,headers,status={'error':'농장이 잠시 쉬고 있어요. 잠깐 뒤에 다시 만나요.'},[],500
    body=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()
    start(f'{status} {HTTPStatus(status).phrase}',[('Content-Type','application/json; charset=utf-8'),('Content-Length',str(len(body))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff')]+headers)
    return [body]

init()
