"""Serve the board locally, without caching anything.

    python tools/serve.py          # http://localhost:8000
    python tools/serve.py 8080     # a different port

Why this exists rather than `python -m http.server`:

The plain server sends no Cache-Control header and answers a revalidation with
304 Not Modified. Browsers cache JavaScript modules hard, so after an edit a
normal reload happily keeps running the previous version of the code. The
symptom is the worst kind - "the fix didn't work" - and it points at exactly
the wrong thing. An afternoon went into chasing a layout bug that had in fact
already been fixed.

So: Cache-Control: no-store on everything, and no 304s. Reload normally and you
get the code that is on disk. Slightly slower, which does not matter for a local
dev server, and never wrong, which does.

This serves the whole project folder over plain HTTP on localhost only. It is a
development tool - it has no authentication and must not be used to serve
anything to anyone else.
"""

import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """A static file handler that refuses to let the browser cache anything."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop Last-Modified so the browser has nothing to revalidate against.
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)

    def send_head(self):
        # Removing the Last-Modified header is not enough on its own: the base
        # class compares If-Modified-Since against the file's mtime itself and
        # returns 304 before any of our headers are involved. A browser holding
        # an older conditional request would still be told "not modified" and
        # keep running stale code. So hide the conditional headers from it.
        for name in ("If-Modified-Since", "If-None-Match"):
            if name in self.headers:
                del self.headers[name]
        return super().send_head()

    def log_message(self, fmt, *args):
        # One tidy line per request; the default includes a timestamp that just
        # makes the output noisier.
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print("Serving %s" % ROOT)
        print("  board  http://localhost:%d/" % port)
        print("  tests  http://localhost:%d/tests/tests.html" % port)
        print("")
        print("Nothing is cached, so a normal reload always gets the current code.")
        print("Ctrl+C to stop.")
        print("")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
