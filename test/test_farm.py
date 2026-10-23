import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

TEMP=tempfile.TemporaryDirectory()
os.environ['MANDRAGORA_DB']=TEMP.name+'/farm.sqlite3'
spec=importlib.util.spec_from_file_location('farm',Path(__file__).parents[1]/'server/app.py')
app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)

def request(path,data=None,cookie='',origin=app.ORIGIN):
    body=json.dumps(data).encode() if data is not None else b''
    env={'PATH_INFO':path,'REQUEST_METHOD':'POST' if data is not None else 'GET','CONTENT_TYPE':'application/json',
         'CONTENT_LENGTH':str(len(body)),'HTTP_ORIGIN':origin,'HTTP_X_MANDRAGORA':'1','HTTP_COOKIE':cookie,
         'REMOTE_ADDR':'127.0.0.1','wsgi.input':io.BytesIO(body)}
    r={}
    def start(status,headers):r.update(status=int(status.split()[0]),headers=dict(headers))
    r['body']=json.loads(b''.join(app.application(env,start)));return r

class FarmTest(unittest.TestCase):
    def setUp(self):
        with app.connect() as db:
            db.execute('DELETE FROM plants');db.execute('DELETE FROM limits')
        self.a=self.visitor();self.b=self.visitor();self.c=self.visitor()
    def visitor(self):return request('/farm')['headers']['Set-Cookie'].split(';')[0]
    def plant(self,cookie=None):
        r=request('/plant',{'body':'오늘도 잘 살아냈어. <script>hello</script>','mood':'cheer','requestId':'a'*32},cookie or self.a)
        self.assertEqual(r['status'],200,r);return r['body']['plantedId']
    def mature(self):
        with app.connect() as db:db.execute('UPDATE plants SET ready=?',(time.time()-1,))
    def test_secret_content_hidden_until_harvest_and_owner_cannot_pull(self):
        pid=self.plant()
        public=request('/farm',cookie=self.b)['body']
        self.assertEqual(set(public['plots'][0]),{'id','mood','created','readyAt','mine'})
        self.assertNotIn('오늘도',json.dumps(public,ensure_ascii=False))
        self.assertEqual(request('/harvest',{'id':pid},self.a)['status'],403)
        self.assertEqual(request('/harvest',{'id':pid},self.b)['status'],409)
        self.mature();r=request('/harvest',{'id':pid},self.b)
        self.assertEqual(r['status'],200)
        self.assertIn('오늘도',r['body']['harvest']['body'])
        self.assertEqual(len(r['body']['basket']),1)
        self.assertEqual(request('/harvest',{'id':pid},self.c)['status'],409)
    def test_only_one_reader_wins_concurrent_harvest(self):
        pid=self.plant();self.mature()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda cookie:request('/harvest',{'id':pid},cookie),[self.b,self.c]))
        self.assertEqual(sorted(r['status'] for r in results),[200,409])
        self.assertEqual(sum(request('/farm',cookie=c)['body']['stats']['received'] for c in [self.b,self.c]),1)
    def test_retries_do_not_duplicate_plants_or_harvests(self):
        pid=self.plant();self.assertEqual(self.plant(),pid)
        self.mature()
        for _ in range(2):self.assertEqual(request('/harvest',{'id':pid},self.b)['status'],200)
        self.assertEqual(request('/farm',cookie=self.a)['body']['stats']['planted'],1)
        self.assertEqual(request('/farm',cookie=self.b)['body']['stats']['received'],1)
    def test_thanks_and_report_require_recipient_and_survive_reload(self):
        pid=self.plant();self.mature();request('/harvest',{'id':pid},self.b)
        self.assertEqual(request('/thanks',{'id':pid},self.c)['status'],403)
        request('/thanks',{'id':pid},self.b);request('/thanks',{'id':pid},self.b)
        self.assertEqual(request('/farm',cookie=self.a)['body']['stats']['thanks'],1)
        request('/report',{'id':pid},self.b)
        self.assertTrue(request('/farm',cookie=self.b)['body']['basket'][0]['reported'])
        self.assertEqual(request('/harvest',{'id':pid},self.b)['status'],409)
    def test_invalid_posts_and_cross_origin_are_rejected(self):
        for body in ['', ' '*10,'x'*281,None,[]]:
            r=request('/plant',{'body':body,'mood':'cheer','requestId':'a'*32},self.a)
            self.assertEqual(r['status'],400)
        self.assertEqual(request('/plant',{},self.a,origin='https://invalid.example')['status'],403)
        self.assertEqual(request('/plant',{})['status'],401)
    def test_cookie_and_archive_are_separate_for_each_visitor(self):
        r=request('/farm');self.assertIn('HttpOnly',r['headers']['Set-Cookie']);self.assertIn('Secure',r['headers']['Set-Cookie'])
        self.plant()
        self.assertEqual(len(request('/farm',cookie=self.a)['body']['planted']),1)
        self.assertEqual(request('/farm',cookie=self.b)['body']['planted'],[])

if __name__=='__main__':unittest.main()
