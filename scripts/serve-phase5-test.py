"""Serve the real UI with memory-only Firebase imports for Firefox testing."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
root = Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def do_GET(self):
        if self.path.split('?')[0] == '/phase5-app':
            source = (root / 'index.html').read_text()
            fixture = '/tests/browser/phase5-fixture.js'
            imports = {f'https://www.gstatic.com/firebasejs/12.19.0/firebase-{name}.js': fixture for name in ['app','auth','firestore','functions']}
            imports.update({f'/{name}.js':fixture for name in ['storage','management','attachment-ui']})
            source=source.replace('<head>', '<head><base href="/phase5-app"><script type="importmap">'+json.dumps({'imports':imports})+'</script><script type="module" src="/auth.js"></script>')
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.end_headers();self.wfile.write(source.encode())
        else:
            super().do_GET()
if __name__ == '__main__':
    print('Firefox test: http://127.0.0.1:8005/tests/browser/phase5.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1',8005),Handler).serve_forever()
