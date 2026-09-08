"""Oracle and harness tests for bounded native smoke fixtures, without PyChrono."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch


SMOKE = Path(__file__).parents[1] / "scripts" / "chrono_smoke.py"
SPEC = importlib.util.spec_from_file_location("chrono_smoke", SMOKE)
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

SQRT_HALF = math.sqrt(0.5)


def dumps(value):
    return json.dumps(value, separators=(",", ":"))


class ScriptedNativeRpc:
    """In-process MCP stand-in that stores exact case bytes and oracle samples."""

    def __init__(self, mutate_case_readback=False):
        self.mutate_case_readback = mutate_case_readback
        self.submitted = {}
        self.records = {}
        self.receipts = {}
        self.tools = []
        self._seen_requests = set()

    def __call__(self, request_id, tool_name, arguments):
        return self.rpc(request_id, tool_name, arguments)

    def rpc(self, request_id, tool_name, arguments):
        del request_id
        self.tools.append(tool_name)
        if tool_name == "chrono_case_submit":
            encoded = arguments["case_json"]
            digest = hashlib.sha256(encoded.encode()).hexdigest()
            if "case_sha256" in arguments:
                assert arguments["case_sha256"] == digest, (arguments["case_sha256"], digest)
            self.submitted[digest] = encoded
            return {
                "ok": True,
                "case_sha256": digest,
                "case_uri": f"chrono-case:sha256:{digest}",
            }
        if tool_name == "chrono_case_get":
            digest = arguments["case_sha256"]
            encoded = self.submitted[digest]
            if self.mutate_case_readback:
                encoded = encoded.replace("root", "xoot", 1)
            return {
                "ok": True,
                "case_sha256": digest,
                "case_uri": f"chrono-case:sha256:{digest}",
                "case_json": encoded,
            }
        if tool_name == "chrono_run_prescribed_kinematics":
            digest = arguments["case_sha256"]
            encoded = self.submitted[digest]
            case = json.loads(encoded)
            observation = smoke.synthetic_completed_observation(case)
            samples = observation["samples"]
            receipt_sha = hashlib.sha256(
                f"receipt:{arguments['request_id']}".encode()
            ).hexdigest()
            record = {
                "observation": {
                    "engine": observation["engine"],
                    "runtime": observation["runtime"],
                    "execution_state": observation["execution_state"],
                    "kinematics_exit": observation["kinematics_exit"],
                    "not_evaluated": observation["not_evaluated"],
                    "sample_count": len(samples),
                    "sample_time_range_s": {
                        "first": samples[0]["time_s"],
                        "last": samples[-1]["time_s"],
                    },
                },
                "sample_page": {
                    "offset": 0,
                    "limit": 16,
                    "total": len(samples),
                    "returned": len(samples),
                    "has_more": False,
                    "samples": samples,
                },
                "receipt": {
                    "case_sha256": digest,
                    "outcome_sha256": "a" * 64,
                    "receipt_sha256": receipt_sha,
                    "execution_state": observation["execution_state"],
                    "kinematics_exit": observation["kinematics_exit"],
                    "runtime": observation["runtime"],
                    "worker": {"source_sha256": "b" * 64},
                    "server_runtime": {"deno_version": "2.9.6"},
                },
            }
            self.records[arguments["request_id"]] = record
            self.receipts[receipt_sha] = record
            replayed = arguments["request_id"] in self._seen_requests
            self._seen_requests.add(arguments["request_id"])
            return {"ok": True, "replayed": replayed, "record": record}
        if tool_name == "chrono_run_get":
            return {
                "ok": True,
                "state": "recorded",
                "record": self.records[arguments["request_id"]],
            }
        if tool_name == "chrono_run_receipt_get":
            return {"ok": True, "record": self.receipts[arguments["receipt_sha256"]]}
        raise AssertionError(f"unexpected tool {tool_name}")


class AnalyticOracleTests(unittest.TestCase):
    def test_one_joint_matches_historical_native_smoke_poses(self):
        case = smoke.one_joint_case()
        t0 = smoke.body_poses_at(case, 0.0)
        self.assertEqual(t0["root"]["position_m"], (0.0, 0.0, 0.0))
        smoke.assert_quaternion_equivalent(t0["root"]["rotation_wxyz"], (1, 0, 0, 0))
        self.assertEqual(t0["arm"]["position_m"], (1.0, 0.0, 0.0))
        smoke.assert_quaternion_equivalent(t0["arm"]["rotation_wxyz"], (1, 0, 0, 0))
        self.assertEqual(smoke.motor_angle(case["joints"][0], 0.0), 0.0)
        self.assertEqual(
            smoke.declared_limit_relation(case["joints"][0], 0.0),
            "within",
        )

        final = smoke.body_poses_at(case, 1.0)
        smoke.assert_vector_close(final["arm"]["position_m"], (0.0, 1.0, 0.0))
        smoke.assert_quaternion_equivalent(
            final["arm"]["rotation_wxyz"],
            (SQRT_HALF, 0.0, 0.0, SQRT_HALF),
        )
        smoke.assert_close(smoke.motor_angle(case["joints"][0], 1.0), math.pi / 2)

    def test_zero_angle_reference_applies_initial_angle_at_t0(self):
        case = smoke.zero_angle_reference_case()
        t0 = smoke.body_poses_at(case, 0.0)
        smoke.assert_close(smoke.motor_angle(case["joints"][0], 0.0), 0.5)
        smoke.assert_vector_close(
            t0["arm"]["position_m"],
            (math.cos(0.5), math.sin(0.5), 0.0),
        )
        smoke.assert_quaternion_equivalent(
            t0["arm"]["rotation_wxyz"],
            (math.cos(0.25), 0.0, 0.0, math.sin(0.25)),
        )

    def test_three_body_tree_composes_two_revolute_angles(self):
        case = smoke.three_body_tree_case()
        self.assertEqual([body["id"] for body in case["bodies"]], ["root", "upper", "forearm"])
        self.assertEqual(
            [joint["id"] for joint in case["joints"]],
            ["shoulder", "elbow"],
        )
        t0 = smoke.body_poses_at(case, 0.0)
        smoke.assert_vector_close(t0["upper"]["position_m"], (1.0, 0.0, 0.0))
        smoke.assert_vector_close(t0["forearm"]["position_m"], (2.0, 0.0, 0.0))

        final = smoke.body_poses_at(case, 1.0)
        smoke.assert_vector_close(final["upper"]["position_m"], (0.0, 1.0, 0.0))
        smoke.assert_quaternion_equivalent(
            final["upper"]["rotation_wxyz"],
            (SQRT_HALF, 0.0, 0.0, SQRT_HALF),
        )
        smoke.assert_vector_close(final["forearm"]["position_m"], (-1.0, 1.0, 0.0))
        smoke.assert_quaternion_equivalent(
            final["forearm"]["rotation_wxyz"],
            (0.0, 0.0, 0.0, 1.0),
        )
        smoke.assert_close(smoke.motor_angle(case["joints"][0], 1.0), math.pi / 2)
        smoke.assert_close(smoke.motor_angle(case["joints"][1], 1.0), math.pi / 2)

    def test_rotated_parent_child_and_joint_frames_use_joint_local_z(self):
        case = smoke.rotated_parent_child_frames_case()
        parent = case["bodies"][0]
        child = case["bodies"][1]
        joint = case["joints"][0]
        smoke.assert_quaternion_equivalent(
            parent["absolute_com_pose"]["rotation_wxyz"],
            (SQRT_HALF, SQRT_HALF, 0.0, 0.0),
        )
        smoke.assert_quaternion_equivalent(
            child["absolute_com_pose"]["rotation_wxyz"],
            (SQRT_HALF, 0.0, SQRT_HALF, 0.0),
        )
        smoke.assert_quaternion_equivalent(
            joint["absolute_joint_frame"]["rotation_wxyz"],
            (SQRT_HALF, SQRT_HALF, 0.0, 0.0),
        )

        t0 = smoke.body_poses_at(case, 0.0)
        smoke.assert_vector_close(t0["root"]["position_m"], (0.0, 0.0, 0.0))
        smoke.assert_quaternion_equivalent(
            t0["root"]["rotation_wxyz"],
            parent["absolute_com_pose"]["rotation_wxyz"],
        )
        smoke.assert_vector_close(t0["arm"]["position_m"], (1.0, 0.0, 0.0))
        smoke.assert_quaternion_equivalent(
            t0["arm"]["rotation_wxyz"],
            child["absolute_com_pose"]["rotation_wxyz"],
        )

        final = smoke.body_poses_at(case, 1.0)
        smoke.assert_vector_close(final["root"]["position_m"], (0.0, 0.0, 0.0))
        smoke.assert_quaternion_equivalent(
            final["root"]["rotation_wxyz"],
            parent["absolute_com_pose"]["rotation_wxyz"],
        )
        smoke.assert_vector_close(final["arm"]["position_m"], (0.0, 0.0, 1.0))
        smoke.assert_quaternion_equivalent(final["arm"]["rotation_wxyz"], (1.0, 0.0, 0.0, 0.0))

    def test_declared_limit_crossing_is_observation_not_not_converged(self):
        case = smoke.declared_limit_crossing_case()
        joint = case["joints"][0]
        self.assertEqual(smoke.declared_limit_relation(joint, 0.0), "below")
        self.assertEqual(smoke.declared_limit_relation(joint, 0.5), "within")
        self.assertEqual(smoke.declared_limit_relation(joint, 1.0), "above")
        self.assertEqual(smoke.motor_angle(joint, 0.0), 0.0)
        smoke.assert_close(smoke.motor_angle(joint, 0.5), 0.25)
        smoke.assert_close(smoke.motor_angle(joint, 1.0), 0.5)
        poses = smoke.body_poses_at(case, 1.0)
        smoke.assert_vector_close(
            poses["arm"]["position_m"],
            (math.cos(0.5), math.sin(0.5), 0.0),
        )
        self.assertIsNone(smoke.NATIVE_NOT_CONVERGED_FIXTURE)
        self.assertIn("NOT_CONVERGED", smoke.NATIVE_NOT_CONVERGED_BOUNDARY)
        self.assertIn("non-native", smoke.NATIVE_NOT_CONVERGED_BOUNDARY)
        self.assertIn("declared-limit", smoke.NATIVE_NOT_CONVERGED_BOUNDARY.lower())

    def test_quaternion_double_cover_is_equivalent(self):
        smoke.assert_quaternion_equivalent((1, 0, 0, 0), (-1, 0, 0, 0))
        with self.assertRaises(AssertionError):
            smoke.assert_quaternion_equivalent((1, 0, 0, 0), (0, 1, 0, 0))

    def test_native_fixtures_are_closed_1_0_trees(self):
        for name, factory in smoke.NATIVE_CASE_FACTORIES:
            case = factory()
            self.assertEqual(case["schema_id"], "chrono-prescribed-kinematics-case/1.0")
            self.assertEqual(len(case["joints"]), len(case["bodies"]) - 1)
            self.assertEqual(sum(1 for body in case["bodies"] if body["fixed"]), 1)
            ids = [body["id"] for body in case["bodies"]]
            self.assertEqual(len(ids), len(set(ids)))
            children = [joint["child_body"] for joint in case["joints"]]
            self.assertEqual(len(children), len(set(children)))


class HarnessTests(unittest.TestCase):
    def test_qualify_run_preserves_supported_positive_exit_names(self):
        case = smoke.three_body_tree_case()
        for code, name in ((2, "ABSTOL_RESIDUAL"), (3, "RELTOL_UPDATE"), (4, "ABSTOL_UPDATE")):
            observation = smoke.synthetic_completed_observation(case)
            observation["kinematics_exit"] = {"raw_code": code, "raw_name": name}
            smoke.qualify_observation(case, observation)

    def test_qualify_run_accepts_oracle_consistent_completed_observation(self):
        case = smoke.three_body_tree_case()
        observation = smoke.synthetic_completed_observation(case)
        smoke.qualify_observation(case, observation)

    def test_qualify_run_rejects_wrong_tree_pose(self):
        case = smoke.three_body_tree_case()
        observation = smoke.synthetic_completed_observation(case)
        observation["samples"][-1]["bodies"][2]["position_m"] = [0.0, 0.0, 0.0]
        with self.assertRaises(AssertionError):
            smoke.qualify_observation(case, observation)

    def test_qualify_run_rejects_limit_crossing_labelled_not_converged(self):
        case = smoke.declared_limit_crossing_case()
        observation = smoke.synthetic_completed_observation(case)
        observation["execution_state"] = "not_converged"
        observation["kinematics_exit"] = {"raw_code": 0, "raw_name": "NOT_CONVERGED"}
        with self.assertRaises(AssertionError):
            smoke.qualify_observation(case, observation)

    def test_qualify_run_rejects_missing_not_evaluated_refusal(self):
        case = smoke.one_joint_case()
        observation = smoke.synthetic_completed_observation(case)
        observation["not_evaluated"] = list(observation["not_evaluated"])[:-1]
        with self.assertRaises(AssertionError):
            smoke.qualify_observation(case, observation)

    def test_scripted_rpc_rereads_exact_case_and_receipt(self):
        fixture = smoke.native_fixtures()[0]
        rpc = ScriptedNativeRpc()
        record = smoke.qualify_native_fixture(rpc, fixture, request_id="harness-one-joint")
        encoded = dumps(fixture.case())
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        self.assertEqual(rpc.submitted[digest], encoded)
        self.assertEqual(record["receipt"]["execution_state"], "completed")
        self.assertIn("chrono_case_get", rpc.tools)
        self.assertIn("chrono_run_receipt_get", rpc.tools)

    def test_scripted_rpc_detects_mutated_case_readback(self):
        fixture = smoke.native_fixtures()[0]
        rpc = ScriptedNativeRpc(mutate_case_readback=True)
        with self.assertRaises(AssertionError):
            smoke.qualify_native_fixture(rpc, fixture, request_id="harness-mutated")

    def test_http_auth_boundary_rejects_missing_bearer(self):
        token = "smoke-test-token"

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                auth = self.headers.get("Authorization")
                if auth != f"Bearer {token}":
                    self.send_response(401)
                    self.send_header("WWW-Authenticate", 'Bearer realm="mcp-chrono"')
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                body = b'{"status":"ok"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            smoke.assert_http_auth_boundary(f"http://127.0.0.1:{port}", token)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_stdio_client_round_trips_structured_tool_call(self):
        script = r"""
import json, sys
while True:
    line = sys.stdin.readline()
    if not line:
        break
    request = json.loads(line)
    sys.stdout.write(json.dumps({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {"structuredContent": {"ok": True, "echo": request["params"]["name"]}},
    }) + "\n")
    sys.stdout.flush()
"""
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as handle:
            handle.write(script)
            path = handle.name
        client = smoke.StdioClient([sys.executable, path])
        try:
            result = client.rpc(1, "chrono_case_get", {"case_sha256": "a" * 64})
            self.assertEqual(result, {"ok": True, "echo": "chrono_case_get"})
        finally:
            client.close()

    def test_cli_requires_http_or_stdio_mode(self):
        completed = subprocess.run(
            [sys.executable, str(SMOKE)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("http", completed.stderr)


class NativeRuntimeAbsentTests(unittest.TestCase):
    def test_pychrono_is_not_imported_by_the_smoke_module(self):
        self.assertNotIn("pychrono", sys.modules)
        with patch.dict(sys.modules, {"pychrono": None, "pychrono.core": None}):
            importlib.util.spec_from_file_location("chrono_smoke_reload", SMOKE)
            spec = importlib.util.spec_from_file_location("chrono_smoke_reload", SMOKE)
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertTrue(hasattr(module, "three_body_tree_case"))

    def test_docker_smoke_wires_http_and_image_stdio_to_the_module(self):
        script = Path(__file__).parents[1].joinpath("scripts", "docker-smoke.sh").read_text()
        self.assertIn('chrono_smoke.py" http --port', script)
        self.assertIn('chrono_smoke.py" stdio --', script)
        self.assertIn("--entrypoint deno", script)
        self.assertIn("/app/server.ts --stdio", script)
        self.assertNotIn("docker build", script)
        self.assertNotIn("docker pull", script)

    def test_case_bytes_are_stable_utf8_identities(self):
        case = smoke.three_body_tree_case()
        encoded = smoke.case_json(case)
        self.assertEqual(encoded, dumps(case))
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        self.assertEqual(len(digest), 64)
        self.assertEqual(encoded, smoke.case_json(case))


if __name__ == "__main__":
    unittest.main()
