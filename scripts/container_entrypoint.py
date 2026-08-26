#!/usr/bin/env python3
"""Authenticated public HTTP boundary for the release container."""

from __future__ import annotations

import hmac
import http.client
import os
import signal
import socket
import subprocess
import sys
import threading
from collections.abc import Iterable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY_BYTES = 600_000
CLIENT_READ_TIMEOUT_S = 5
MAX_CONCURRENT_CLIENTS = 32
BEARER_CHALLENGE = 'Bearer realm="mcp-chrono"'
HTTP_TOKEN_CHARACTERS = frozenset(
    "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
)
HOP_BY_HOP_HEADERS = frozenset({
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "trailers",
    "transfer-encoding",
    "upgrade",
})
REQUEST_HEADER_BLOCKLIST = HOP_BY_HOP_HEADERS | frozenset({
    "authorization",
    "content-length",
    "expect",
    "host",
})
CHILD_ENVIRONMENT_KEYS = frozenset({
    "CHRONO_PYTHON",
    "CHRONO_STORE_DIR",
    "DENO_DIR",
    "HOST",
    "PATH",
    "PORT",
    "PYTHONDONTWRITEBYTECODE",
})


def authorized(value: str | None, token: str) -> bool:
    if value is None:
        return False
    try:
        return hmac.compare_digest(value, f"Bearer {token}")
    except (TypeError, ValueError):
        # compare_digest rejects non-ASCII str inputs; an invalid credential is
        # still an authentication failure, never a proxy error.
        return False


def header_values(
    headers: Iterable[tuple[str, str]], name: str,
) -> list[str]:
    """Return all case-insensitive occurrences, including duplicates."""
    normalized_name = name.lower()
    return [value for key, value in headers if key.lower() == normalized_name]


def connection_named_headers(headers: Iterable[tuple[str, str]]) -> set[str]:
    """Return syntactically simple field names nominated by Connection."""
    nominated: set[str] = set()
    for value in header_values(headers, "Connection"):
        for candidate in value.split(","):
            token = candidate.strip()
            if token and all(character in HTTP_TOKEN_CHARACTERS for character in token):
                nominated.add(token.lower())
    return nominated


def parse_content_length(value: str | None) -> int | None:
    if value is None:
        return 0
    if not value.isascii() or not value.isdecimal():
        return None
    significant = value.lstrip("0") or "0"
    if len(significant) > len(str(MAX_BODY_BYTES)):
        return MAX_BODY_BYTES + 1
    try:
        return int(significant)
    except ValueError:
        # Do not attempt to read a body whose size has not been bounded.
        return None


def stop_child(child: subprocess.Popen[object], timeout_s: float = 10) -> int | None:
    if child.poll() is not None:
        return child.returncode
    child.terminate()
    try:
        return child.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        child.kill()
        return child.wait(timeout=timeout_s)


def build_child_environment(internal_port: int) -> dict[str, str]:
    """Return the complete non-secret environment of the loopback Deno child."""
    environment = {
        "CHRONO_PYTHON": "/opt/conda/bin/python",
        "CHRONO_STORE_DIR": "/data",
        "DENO_DIR": "/opt/deno",
        "HOST": "127.0.0.1",
        "PATH": "/opt/conda/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PORT": str(internal_port),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    assert frozenset(environment) == CHILD_ENVIRONMENT_KEYS
    return environment


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Threaded HTTP server with bounded client reads and overload rejection."""

    daemon_threads = True
    client_read_timeout_s = CLIENT_READ_TIMEOUT_S
    max_concurrent_clients = MAX_CONCURRENT_CLIENTS

    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler: type[BaseHTTPRequestHandler],
    ) -> None:
        super().__init__(server_address, request_handler)
        self._request_slots = threading.BoundedSemaphore(
            self.max_concurrent_clients,
        )

    def process_request(
        self,
        request: socket.socket,
        client_address: tuple[str, int],
    ) -> None:
        if self._request_slots.acquire(blocking=False):
            try:
                super().process_request(request, client_address)
            except BaseException:
                self._request_slots.release()
                try:
                    request.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                request.close()
                raise
            return
        try:
            request.settimeout(1)
            request.sendall(
                b"HTTP/1.1 503 Service Unavailable\r\n"
                b"Connection: close\r\nContent-Length: 0\r\n\r\n",
            )
        except OSError:
            pass
        finally:
            try:
                request.setblocking(False)
                request.recv(65536)
            except OSError:
                pass
            try:
                request.shutdown(socket.SHUT_WR)
            except OSError:
                pass
            request.close()

    def process_request_thread(
        self,
        request: socket.socket,
        client_address: tuple[str, int],
    ) -> None:
        try:
            request.settimeout(self.client_read_timeout_s)
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    bearer_token = ""
    internal_port = 3026

    def do_GET(self) -> None:
        self.forward()

    def do_POST(self) -> None:
        self.forward()

    def do_OPTIONS(self) -> None:
        self.forward()

    def handle_expect_100(self) -> bool:
        # Do not send a provisional response for a body this public boundary
        # will refuse. parse_request() will stop before dispatching do_POST.
        self.reject(417, "Expectation Failed")
        return False

    def reject(self, status: int, message: str) -> None:
        # No rejected request body is consumed. Always close the client-side
        # connection so it cannot be parsed as a follow-up request.
        self.close_connection = True
        self.send_response(status, message)
        self.send_header("Connection", "close")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def reject_unauthenticated(self) -> None:
        self.close_connection = True
        self.send_response(401)
        self.send_header("WWW-Authenticate", BEARER_CHALLENGE)
        self.send_header("Connection", "close")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def forward(self) -> None:
        # We do not drain a rejected request body, so this must be true before
        # every rejection as well as on the successful proxy response.
        self.close_connection = True
        request_headers = list(self.headers.items())
        if header_values(request_headers, "Transfer-Encoding"):
            self.reject(400, "Transfer-Encoding is not supported")
            return
        if len(header_values(request_headers, "Content-Length")) > 1:
            self.reject(400, "Duplicate Content-Length")
            return
        if header_values(request_headers, "Expect"):
            self.reject(417, "Expectation Failed")
            return
        authorization_values = header_values(request_headers, "Authorization")
        if len(authorization_values) > 1:
            self.reject(400, "Duplicate Authorization")
            return
        authorization = authorization_values[0] if authorization_values else None
        if not authorized(authorization, self.bearer_token):
            self.reject_unauthenticated()
            return
        content_length_values = header_values(request_headers, "Content-Length")
        length = parse_content_length(
            content_length_values[0] if content_length_values else None,
        )
        if length is None:
            self.reject(400, "Invalid Content-Length")
            return
        if length > MAX_BODY_BYTES:
            self.reject(413, "Request body too large")
            return
        try:
            body = self.rfile.read(length) if length else None
        except TimeoutError:
            self.reject(408, "Request body timeout")
            return
        if body is not None and len(body) != length:
            self.reject(400, "Incomplete request body")
            return
        skip = REQUEST_HEADER_BLOCKLIST | connection_named_headers(request_headers)
        headers = {
            key: value for key, value in request_headers if key.lower() not in skip
        }
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.internal_port, timeout=65
        )
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            upstream = connection.getresponse()
            response_body = upstream.read()
            self.send_response(upstream.status, upstream.reason)
            upstream_headers = upstream.getheaders()
            response_skip = (
                REQUEST_HEADER_BLOCKLIST
                | connection_named_headers(upstream_headers)
            )
            for key, value in upstream_headers:
                if key.lower() not in response_skip:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(response_body)
        except http.client.HTTPException:
            self.reject(502, "Invalid response from MCP service")
        except OSError:
            self.reject(503, "MCP service unavailable")
        finally:
            connection.close()

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("[mcp-chrono proxy] " + format % args + "\n")


def supervise(
    server: BoundedThreadingHTTPServer,
    child: subprocess.Popen[object],
    stop_requested: threading.Event,
    child_died: threading.Event,
) -> None:
    while not stop_requested.wait(0.2):
        if child.poll() is not None:
            child_died.set()
            server.shutdown()
            return
    stop_child(child)
    server.shutdown()


def main() -> int:
    token = os.environ.get("MCP_BEARER_TOKEN", "")
    if not token:
        raise SystemExit(
            "MCP_BEARER_TOKEN must be set for the network-facing container."
        )
    public_host = os.environ.get("HOST", "0.0.0.0")
    public_port = int(os.environ.get("PORT", "3025"))
    internal_port = int(os.environ.get("CHRONO_INTERNAL_PORT", "3026"))
    ProxyHandler.bearer_token = token
    ProxyHandler.internal_port = internal_port

    child_environment = build_child_environment(internal_port)
    child = subprocess.Popen([
        "deno", "run", "--cached-only",
        # mcp-server probes its complete optional auth config surface, even on
        # this loopback path. Broad env permission is safe because the child
        # inherits only build_child_environment(), never proxy/parent secrets.
        "--allow-env",
        f"--allow-net=127.0.0.1:{internal_port}",
        "--allow-read=/app,/data,/opt/deno", "--allow-write=/data",
        "--allow-run=/opt/conda/bin/python", "/app/server.ts",
    ], env=child_environment)
    try:
        server = BoundedThreadingHTTPServer(
            (public_host, public_port),
            ProxyHandler,
        )
    except BaseException:
        stop_child(child)
        raise

    stop_requested = threading.Event()
    child_died = threading.Event()

    def request_stop(_: int, __: object) -> None:
        stop_requested.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    watcher = threading.Thread(
        target=supervise,
        args=(server, child, stop_requested, child_died),
        daemon=True,
    )
    watcher.start()
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        stop_requested.set()
        watcher.join(timeout=12)
        server.server_close()
        if child.poll() is None:
            stop_child(child)
    return 1 if child_died.is_set() else 0


if __name__ == "__main__":
    raise SystemExit(main())
