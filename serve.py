#!/usr/bin/env python3
"""Static file server for raven-echo local preview."""
import http.server
import os
import sys

PORT = 3001
os.chdir(os.path.dirname(os.path.abspath(__file__)))

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({".md": "text/markdown; charset=utf-8"})

server = http.server.HTTPServer(("", PORT), handler)
print(f"raven-echo serving at http://localhost:{PORT}")
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
