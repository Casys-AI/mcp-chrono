"""Focused release-boundary tests for the container entrypoint."""

from __future__ import annotations

from email.message import Message
import importlib.util
from io import BytesIO
from pathlib import Path
import socket
import subprocess
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ENTRYPOINT = Path(__file__).parents[1] / "scripts" / "container_entrypoint.py"
SPEC = importlib.util.spec_from_file_location("container_entrypoint", ENTRYPOINT)
assert SPEC is not None and SPEC.loader is not None
entrypoint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(entrypoint)


class HungChild:
    """A Popen-shaped child that requires the termination fallback."""

    def __init__(self) -> None:
        self.returncode: int | None = None
        self.terminated = 0
        self.killed = 0
        self.waits = 0

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.terminated += 1

    def kill(self) -> None:
        self.killed += 1
        self.returncode = -9

    def wait(self, timeout: float) -> int:
        self.waits += 1
        if self.waits == 1:
            raise subprocess.TimeoutExpired("deno", timeout)
        assert self.returncode is not None
        return self.returncode


class ContainerEntrypointTests(unittest.TestCase):
    def start_server(
        self,
        handler: type[BaseHTTPRequestHandler],
        server_type: type[ThreadingHTTPServer] = ThreadingHTTPServer,
    ) -> ThreadingHTTPServer:
        server = server_type(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        return server

    def start_proxy(
        self,
        internal_port: int,
        token: str = "proxy-boundary-secret",
        client_read_timeout_s: float | None = None,
        max_concurrent_clients: int | None = None,
    ) -> ThreadingHTTPServer:
        handler = type("TestProxyHandler", (entrypoint.ProxyHandler,), {
            "bearer_token": token,
            "internal_port": internal_port,
        })
        server_attributes: dict[str, int | float] = {}
        if client_read_timeout_s is not None:
            server_attributes["client_read_timeout_s"] = client_read_timeout_s
        if max_concurrent_clients is not None:
            server_attributes["max_concurrent_clients"] = max_concurrent_clients
        server_type = type(
            "TestBoundedProxyServer",
            (entrypoint.BoundedThreadingHTTPServer,),
            server_attributes,
        )
        return self.start_server(handler, server_type)

    def raw_request(
        self,
        port: int,
        request: bytes,
        half_close: bool = False,
    ) -> bytes:
        with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
            client.settimeout(2)
            client.sendall(request)
            if half_close:
                client.shutdown(socket.SHUT_WR)
            chunks = []
            while chunk := client.recv(65536):
                chunks.append(chunk)
        return b"".join(chunks)

    def test_child_environment_is_explicit_and_never_contains_proxy_secrets(self) -> None:
        child_environment = entrypoint.build_child_environment(3026)
        self.assertEqual(
            set(child_environment),
            set(entrypoint.CHILD_ENVIRONMENT_KEYS),
        )
        self.assertEqual(child_environment["HOST"], "127.0.0.1")
        self.assertEqual(child_environment["PORT"], "3026")
        self.assertEqual(child_environment["CHRONO_STORE_DIR"], "/data")
        self.assertEqual(child_environment["CHRONO_PYTHON"], "/opt/conda/bin/python")
        self.assertNotIn("MCP_BEARER_TOKEN", child_environment)
        self.assertNotIn("MCP_AUTH_TOKENS", child_environment)
        self.assertNotIn("MCP_AUTH_RESOURCE", child_environment)
        self.assertNotIn("UNRELATED_PARENT_SECRET", child_environment)

    def test_proxy_never_forwards_authorization_to_the_loopback_child(self) -> None:
        captured: dict[str, object] = {}

        class UpstreamResponse:
            status = 200
            reason = "OK"

            def read(self) -> bytes:
                return b"{}"

            def getheaders(self) -> list[tuple[str, str]]:
                return []

        class CapturingConnection:
            def __init__(self, host: str, port: int, timeout: int) -> None:
                captured.update({"host": host, "port": port, "timeout": timeout})

            def request(
                self,
                method: str,
                path: str,
                body: bytes | None,
                headers: dict[str, str],
            ) -> None:
                captured.update({
                    "method": method,
                    "path": path,
                    "body": body,
                    "headers": headers,
                })

            def getresponse(self) -> UpstreamResponse:
                return UpstreamResponse()

            def close(self) -> None:
                return None

        headers = Message()
        headers["Authorization"] = "Bearer proxy-boundary-secret"
        headers["Mcp-Method"] = "tools/list"
        handler = object.__new__(entrypoint.ProxyHandler)
        handler.headers = headers
        handler.command = "GET"
        handler.path = "/mcp"
        handler.rfile = BytesIO()
        handler.wfile = BytesIO()
        handler.bearer_token = "proxy-boundary-secret"
        handler.internal_port = 3026
        handler.send_response = lambda *_: None
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None

        with patch.object(
            entrypoint.http.client,
            "HTTPConnection",
            CapturingConnection,
        ):
            handler.forward()

        forwarded = captured["headers"]
        self.assertIsInstance(forwarded, dict)
        self.assertNotIn("Authorization", forwarded)
        self.assertEqual(forwarded["Mcp-Method"], "tools/list")
        self.assertEqual(captured["host"], "127.0.0.1")
        self.assertEqual(captured["port"], 3026)

    def test_proxy_rejects_transfer_encoding_and_duplicate_content_length(self) -> None:
        proxy = self.start_proxy(1)
        port = proxy.server_address[1]
        transfer_encoding_response = self.raw_request(port, (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Transfer-Encoding: chunked\r\n\r\n"
            b"0\r\n\r\n"
        ))
        duplicate_length_response = self.raw_request(port, (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n"
            b"Content-Length: 3\r\n\r\n"
            b"abc"
        ))
        self.assertIn(b"400 Transfer-Encoding is not supported", transfer_encoding_response)
        self.assertIn(b"400 Duplicate Content-Length", duplicate_length_response)
        self.assertIn(b"Connection: close", transfer_encoding_response)
        self.assertIn(b"Connection: close", duplicate_length_response)

    def test_proxy_rejects_expect_without_sending_100_continue(self) -> None:
        proxy = self.start_proxy(1)
        continue_response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n"
            b"Expect: 100-continue\r\n\r\n"
        ))
        unexpected_response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n"
            b"Expect: unsupported\r\n\r\n"
        ))
        self.assertIn(b"417 Expectation Failed", continue_response)
        self.assertNotIn(b"100 Continue", continue_response)
        self.assertIn(b"Connection: close", continue_response)
        self.assertIn(b"417 Expectation Failed", unexpected_response)
        self.assertIn(b"Connection: close", unexpected_response)

    def test_proxy_rejects_duplicate_authorization(self) -> None:
        proxy = self.start_proxy(1)
        response = self.raw_request(proxy.server_address[1], (
            b"GET /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n\r\n"
        ))
        self.assertIn(b"400 Duplicate Authorization", response)
        self.assertIn(b"Connection: close", response)

    def test_unauthenticated_request_closes_before_its_body_is_consumed(self) -> None:
        proxy = self.start_proxy(1)
        response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Content-Length: 600000\r\n\r\n"
        ))
        self.assertIn(b"401 Unauthorized", response)
        self.assertIn(b'WWW-Authenticate: Bearer realm="mcp-chrono"', response)
        self.assertIn(b"Connection: close", response)
        self.assertTrue(response.endswith(b"\r\n\r\n"))

    def test_truncated_body_is_rejected_without_contacting_the_backend(self) -> None:
        captured = {"requests": 0}

        class BackendHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                captured["requests"] += 1
                self.send_response(200)
                self.end_headers()

            def log_message(self, format: str, *args: object) -> None:
                return None

        backend = self.start_server(BackendHandler)
        proxy = self.start_proxy(backend.server_address[1])
        response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n\r\n"
            b"ab"
        ), half_close=True)
        self.assertIn(b"400 Incomplete request body", response)
        self.assertIn(b"Connection: close", response)
        self.assertEqual(captured["requests"], 0)

    def test_stalled_request_body_times_out_without_contacting_the_backend(self) -> None:
        proxy = self.start_proxy(1, client_read_timeout_s=0.05)
        start = time.monotonic()
        response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n\r\n"
        ))
        self.assertLess(time.monotonic() - start, 1)
        self.assertIn(b"408 Request body timeout", response)
        self.assertIn(b"Connection: close", response)

    def test_proxy_rejects_overload_while_a_client_body_is_stalled(self) -> None:
        proxy = self.start_proxy(
            1,
            client_read_timeout_s=1,
            max_concurrent_clients=1,
        )
        client = socket.create_connection(("127.0.0.1", proxy.server_address[1]))
        self.addCleanup(client.close)
        client.sendall(
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Content-Length: 3\r\n\r\n",
        )
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            acquired = proxy._request_slots.acquire(blocking=False)  # type: ignore[attr-defined]
            if not acquired:
                break
            proxy._request_slots.release()  # type: ignore[attr-defined]
            time.sleep(0.01)
        else:
            self.fail("stalled client never occupied the only proxy slot")
        response = self.raw_request(proxy.server_address[1], (
            b"GET /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n\r\n"
        ))
        self.assertIn(b"503 Service Unavailable", response)
        self.assertIn(b"Connection: close", response)

    def test_failed_client_thread_start_releases_the_slot_and_closes_the_socket(self) -> None:
        server_type = type("OneSlotServer", (entrypoint.BoundedThreadingHTTPServer,), {
            "max_concurrent_clients": 1,
        })
        server = server_type(("127.0.0.1", 0), entrypoint.ProxyHandler)
        self.addCleanup(server.server_close)
        request, peer = socket.socketpair()
        self.addCleanup(peer.close)
        with patch.object(threading.Thread, "start", side_effect=RuntimeError("start failed")):
            with self.assertRaisesRegex(RuntimeError, "start failed"):
                server.process_request(request, ("127.0.0.1", 0))
        self.assertEqual(request.fileno(), -1)
        self.assertTrue(server._request_slots.acquire(blocking=False))
        server._request_slots.release()

    def test_proxy_strips_sensitive_and_hop_by_hop_headers_and_recalculates_length(self) -> None:
        captured: dict[str, object] = {}

        class BackendHandler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:
                lengths = self.headers.get_all("Content-Length")
                assert lengths is not None
                length = int(lengths[0])
                captured["body"] = self.rfile.read(length)
                captured["headers"] = dict(self.headers.items())
                captured["length_values"] = lengths
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, format: str, *args: object) -> None:
                return None

        backend = self.start_server(BackendHandler)
        proxy = self.start_proxy(backend.server_address[1])
        response = self.raw_request(proxy.server_address[1], (
            b"POST /mcp HTTP/1.1\r\n"
            b"Host: public.example\r\n"
            b"Authorization: Bearer proxy-boundary-secret\r\n"
            b"Proxy-Authorization: Basic dGVzdA==\r\n"
            b"Proxy-Connection: keep-alive\r\n"
            b"Connection: Keep-Alive, X-Client-Hop\r\n"
            b"Keep-Alive: timeout=5\r\n"
            b"Trailer: X-Checksum\r\n"
            b"X-Client-Hop: remove-me\r\n"
            b"Content-Length: 00007\r\n"
            b"Mcp-Method: tools/list\r\n\r\n"
            b"payload"
        ))
        self.assertIn(b"200 OK", response)
        self.assertIn(b"Connection: close", response)
        self.assertEqual(captured["body"], b"payload")
        self.assertEqual(captured["length_values"], ["7"])
        forwarded = captured["headers"]
        self.assertIsInstance(forwarded, dict)
        for name in (
            "Authorization",
            "Proxy-Authorization",
            "Proxy-Connection",
            "Connection",
            "Keep-Alive",
            "Trailer",
            "X-Client-Hop",
        ):
            self.assertNotIn(name, forwarded)
        self.assertEqual(forwarded["Mcp-Method"], "tools/list")

    def test_content_length_accepts_only_bounded_decimal_input(self) -> None:
        self.assertEqual(entrypoint.parse_content_length(None), 0)
        self.assertEqual(entrypoint.parse_content_length("600000"), 600000)
        for value in ("", "-1", "+1", "1.0", " 1", "1 ", "１２"):
            self.assertIsNone(entrypoint.parse_content_length(value), value)
        self.assertEqual(
            entrypoint.parse_content_length("9" * 5000),
            entrypoint.MAX_BODY_BYTES + 1,
        )

    def test_bearer_challenge_is_a_bearer_challenge_not_oauth_discovery(self) -> None:
        self.assertEqual(
            entrypoint.BEARER_CHALLENGE,
            'Bearer realm="mcp-chrono"',
        )
        self.assertTrue(entrypoint.authorized("Bearer secret", "secret"))
        self.assertFalse(entrypoint.authorized("Bearer different", "secret"))
        self.assertFalse(entrypoint.authorized("Bearer short", "much-longer-secret"))
        self.assertFalse(entrypoint.authorized("Bearer secr\u00e8t", "secret"))

    def test_stuck_child_is_terminated_then_killed_with_a_bounded_wait(self) -> None:
        child = HungChild()
        self.assertEqual(entrypoint.stop_child(child, timeout_s=0.001), -9)
        self.assertEqual(child.terminated, 1)
        self.assertEqual(child.killed, 1)
        self.assertEqual(child.waits, 2)

    def test_signal_handler_only_requests_stop(self) -> None:
        source = ENTRYPOINT.read_text(encoding="utf-8")
        start = source.index("def request_stop")
        end = source.index("signal.signal", start)
        handler = source[start:end]
        self.assertIn("stop_requested.set()", handler)
        self.assertNotIn("server.shutdown", handler)

    def test_child_uses_broad_env_permission_only_after_environment_minimization(self) -> None:
        source = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('"--allow-env",', source)
        self.assertNotIn('"--allow-env=', source)
        self.assertIn("child_environment = build_child_environment(internal_port)", source)
        self.assertIn("env=child_environment", source)


if __name__ == "__main__":
    unittest.main()
