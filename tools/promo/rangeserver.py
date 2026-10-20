import http.server,os,re,sys
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path=self.translate_path(self.path.split('?')[0])
        rng=self.headers.get('Range')
        if not rng or not os.path.isfile(path): return super().send_head()
        m=re.match(r'bytes=(\d+)-(\d*)',rng); size=os.path.getsize(path)
        a=int(m.group(1)); b=int(m.group(2)) if m.group(2) else size-1; b=min(b,size-1)
        f=open(path,'rb'); f.seek(a); self.send_response(206)
        self.send_header('Content-Type',self.guess_type(path)); self.send_header('Content-Range',f'bytes {a}-{b}/{size}')
        self.send_header('Content-Length',str(b-a+1)); self.send_header('Accept-Ranges','bytes'); self.end_headers()
        self._left=b-a+1; return f
    def copyfile(self,src,dst):
        n=getattr(self,'_left',None)
        if n is None: return super().copyfile(src,dst)
        while n>0:
            buf=src.read(min(65536,n))
            if not buf: break
            dst.write(buf); n-=len(buf)
    def log_message(self,*a): pass
os.chdir(sys.argv[1]); http.server.ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
