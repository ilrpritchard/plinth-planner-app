#!/usr/bin/env python3
"""PL/NNER dev server: python3 dev-server.py [port]  ->  http://localhost:8082

Same as `python3 -m http.server`, but every response says Cache-Control: no-store.
The plain server lets the browser keep stale ES modules for hours, so a change to
src/ui/icon.js (say) does not show until a hard refresh, and sometimes not even
then. With this one a normal reload always shows the current files.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_response(self, code, message=None):
        # never answer 304 from a stale validator: drop conditional headers
        super().send_response(code, message)

    def do_GET(self):
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers:
                del self.headers[h]
        super().do_GET()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
    print(f'PL/NNER dev server (no caching): http://localhost:{port}')
    ThreadingHTTPServer(('', port), NoStore).serve_forever()
