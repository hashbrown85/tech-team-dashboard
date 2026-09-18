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

It is also THREADED, which is not a detail. The board imports about thirty-five
ES modules, and a browser fetches them over several connections at once - it also
opens speculative connections that it does not immediately send a request on. A
single-threaded server handles one connection at a time and will sit blocked on
one of those idle connections while every module request queues behind it. The
page then stops at "Loading the board..." forever, intermittently, with nothing
on screen to say why. Clearing site data appears to fix it, because that drops
the stalled connections - which sends you looking at the browser instead of here.

This serves the whole project folder over plain HTTP on localhost only. It is a
development tool - it has no authentication and must not be used to serve
anything to anyone else.
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """A static file handler that refuses to let the browser cache anything."""

    # Keep-alive, so the browser reuses a few connections for thirty-five modules
    # rather than opening one per file. Safe here because SimpleHTTPRequestHandler
    # sends a Content-Length on every response it makes.
    protocol_version = "HTTP/1.1"

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


class Server(http.server.ThreadingHTTPServer):
    """Threaded, and refusing to share a port.

    `allow_reuse_address` is False on purpose. Python's HTTPServer sets it to 1,
    and on Windows that flag lets a SECOND server bind a port another one is
    already listening on. Both then show up in netstat, requests land on whichever
    socket wins, and some of them reach a process that is no longer serving the
    files you just edited. That happened here, and it looks exactly like the app
    being broken. Failing on startup and saying so is far kinder.
    """

    allow_reuse_address = False
    daemon_threads = True          # Ctrl+C should not wait on open connections


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)

    try:
        httpd = Server(("127.0.0.1", port), handler)
    except OSError as err:
        print("Could not start on port %d: %s" % (port, err))
        print("")
        print("Something is already listening there - most likely a server you")
        print("started earlier and forgot about. Stop that one, then try again.")
        print("")
        print("Think twice before just using a different port. The browser saves")
        print("your board per ADDRESS, so another port is a DIFFERENT board and")
        print("yours will look empty.")
        return 1

    with httpd:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
