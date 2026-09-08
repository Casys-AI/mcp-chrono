#!/usr/bin/env python3
"""Bounded native prescribed-kinematics smoke fixtures, analytic oracle, and transports.

This module is the container-smoke qualification path. It does not import PyChrono.
A connected acyclic revolute tree is not a deterministic native NOT_CONVERGED
fixture; declared-limit below/above is not engine non-convergence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import select
import subprocess
import sys
import threading
import urllib.error
import urllib.request


PROTO = "2026-07-28"
NOT_EVALUATED = [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
]
IDENTITY = [1.0, 0.0, 0.0, 0.0]
SQRT_HALF = math.sqrt(0.5)
POSE_TOLERANCE = 1e-5
NATIVE_NOT_CONVERGED_FIXTURE = None
NATIVE_NOT_CONVERGED_BOUNDARY = (
    "A supported 1.0 connected revolute tree is not a deterministic native "
    "NOT_CONVERGED fixture. Declared-limit below/above is an observation, not "
    "engine non-convergence. Literal NOT_CONVERGED is qualified by injected "
    "worker output over MCP transport and the request ledger, labelled non-native."
)


def case_json(case):
    return json.dumps(case, separators=(",", ":"))


def _pose(position, rotation):
    return {"position_m": list(position), "rotation_wxyz": list(rotation)}


def _body(body_id, fixed, position, rotation=IDENTITY):
    return {
        "id": body_id,
        "fixed": fixed,
        "absolute_com_pose": _pose(position, rotation),
    }


def _joint(joint_id, parent, child, joint_position, ramp, limits, joint_rotation=IDENTITY):
    return {
        "id": joint_id,
        "parent_body": parent,
        "child_body": child,
        "absolute_joint_frame": _pose(joint_position, joint_rotation),
        "angle_ramp": {
            "initial_angle_rad": ramp[0],
            "angular_speed_rad_s": ramp[1],
        },
        "limits_rad": list(limits),
    }


def _case(bodies, joints, duration_s=1, step_s=0.1, sample_every_steps=5):
    return {
        "schema_id": "chrono-prescribed-kinematics-case/1.0",
        "units": {"length": "m", "angle": "rad", "time": "s"},
        "frame": {"handedness": "right"},
        "bodies": bodies,
        "joints": joints,
        "duration_s": duration_s,
        "step_s": step_s,
        "sample_every_steps": sample_every_steps,
    }


def one_joint_case():
    return _case(
        [
            _body("root", True, [0, 0, 0]),
            _body("arm", False, [1, 0, 0]),
        ],
        [_joint("hinge", "root", "arm", [0, 0, 0], (0, math.pi / 2), (-math.pi / 2, math.pi / 2))],
    )


def zero_angle_reference_case():
    return _case(
        [
            _body("root", True, [0, 0, 0]),
            _body("arm", False, [1, 0, 0]),
        ],
        [_joint("hinge", "root", "arm", [0, 0, 0], (0.5, 0), (-1, 1))],
        sample_every_steps=1,
    )


def three_body_tree_case():
    return _case(
        [
            _body("root", True, [0, 0, 0]),
            _body("upper", False, [1, 0, 0]),
            _body("forearm", False, [2, 0, 0]),
        ],
        [
            _joint("shoulder", "root", "upper", [0, 0, 0], (0, math.pi / 2), (-math.pi, math.pi)),
            _joint("elbow", "upper", "forearm", [1, 0, 0], (0, math.pi / 2), (-math.pi, math.pi)),
        ],
    )


def rotated_parent_child_frames_case():
    rx = [SQRT_HALF, SQRT_HALF, 0.0, 0.0]
    ry = [SQRT_HALF, 0.0, SQRT_HALF, 0.0]
    return _case(
        [
            _body("root", True, [0, 0, 0], rx),
            _body("arm", False, [1, 0, 0], ry),
        ],
        [_joint("hinge", "root", "arm", [0, 0, 0], (0, math.pi / 2), (-math.pi, math.pi), rx)],
    )


def declared_limit_crossing_case():
    return _case(
        [
            _body("root", True, [0, 0, 0]),
            _body("arm", False, [1, 0, 0]),
        ],
        [_joint("hinge", "root", "arm", [0, 0, 0], (0, 0.5), (0.2, 0.4))],
    )


NATIVE_CASE_FACTORIES = (
    ("one-joint", one_joint_case),
    ("three-body-tree", three_body_tree_case),
    ("rotated-parent-child-frames", rotated_parent_child_frames_case),
    ("declared-limit-crossing", declared_limit_crossing_case),
)


class NativeFixture:
    def __init__(self, name, factory, request_id):
        self.name = name
        self.factory = factory
        self.request_id = request_id

    def case(self):
        return self.factory()


def native_fixtures():
    return [
        NativeFixture("one-joint", one_joint_case, "native-smoke-one-joint"),
        NativeFixture(
            "three-body-tree",
            three_body_tree_case,
            "native-smoke-three-body-tree",
        ),
        NativeFixture(
            "rotated-parent-child-frames",
            rotated_parent_child_frames_case,
            "native-smoke-rotated-parent-child-frames",
        ),
        NativeFixture(
            "declared-limit-crossing",
            declared_limit_crossing_case,
            "native-smoke-declared-limit-crossing",
        ),
    ]


def quat_mul(left, right):
    w1, x1, y1, z1 = left
    w2, x2, y2, z2 = right
    return (
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    )


def quat_conj(quat):
    return (quat[0], -quat[1], -quat[2], -quat[3])


def quat_normalize(quat):
    norm = math.sqrt(sum(component * component for component in quat))
    if norm == 0.0:
        raise AssertionError(f"zero quaternion {quat}")
    return tuple(component / norm for component in quat)


def quat_rotate(quat, vector):
    rotated = quat_mul(quat_mul(quat, (0.0, vector[0], vector[1], vector[2])), quat_conj(quat))
    return (rotated[1], rotated[2], rotated[3])


def axis_angle_quat(axis, angle):
    length = math.sqrt(sum(component * component for component in axis))
    half = angle / 2.0
    scale = math.sin(half) / length
    return quat_normalize((math.cos(half), axis[0] * scale, axis[1] * scale, axis[2] * scale))


def vec_add(left, right):
    return tuple(a + b for a, b in zip(left, right))


def vec_sub(left, right):
    return tuple(a - b for a, b in zip(left, right))


def as_tuple3(values):
    return (float(values[0]), float(values[1]), float(values[2]))


def as_tuple4(values):
    return (float(values[0]), float(values[1]), float(values[2]), float(values[3]))


def motor_angle(joint, time_s):
    ramp = joint["angle_ramp"]
    return ramp["initial_angle_rad"] + ramp["angular_speed_rad_s"] * time_s


def declared_limit_relation(joint, time_s):
    observed = motor_angle(joint, time_s)
    lower, upper = joint["limits_rad"]
    if observed < lower:
        return "below"
    if observed > upper:
        return "above"
    return "within"


def body_poses_at(case, time_s):
    bodies = {body["id"]: body for body in case["bodies"]}
    joints_by_child = {joint["child_body"]: joint for joint in case["joints"]}
    poses = {}

    def pose_of(body_id):
        if body_id in poses:
            return poses[body_id]
        body = bodies[body_id]
        zero = body["absolute_com_pose"]
        if body["fixed"]:
            poses[body_id] = {
                "position_m": as_tuple3(zero["position_m"]),
                "rotation_wxyz": quat_normalize(as_tuple4(zero["rotation_wxyz"])),
            }
            return poses[body_id]
        joint = joints_by_child[body_id]
        parent = pose_of(joint["parent_body"])
        parent_zero = bodies[joint["parent_body"]]["absolute_com_pose"]
        joint_zero = joint["absolute_joint_frame"]
        parent_delta = quat_mul(
            parent["rotation_wxyz"],
            quat_conj(as_tuple4(parent_zero["rotation_wxyz"])),
        )
        joint_current_pos = vec_add(
            quat_rotate(
                parent_delta,
                vec_sub(as_tuple3(joint_zero["position_m"]), as_tuple3(parent_zero["position_m"])),
            ),
            parent["position_m"],
        )
        joint_current_rot = quat_normalize(
            quat_mul(parent_delta, as_tuple4(joint_zero["rotation_wxyz"]))
        )
        child_in_joint_pos = quat_rotate(
            quat_conj(as_tuple4(joint_zero["rotation_wxyz"])),
            vec_sub(as_tuple3(zero["position_m"]), as_tuple3(joint_zero["position_m"])),
        )
        child_in_joint_rot = quat_mul(
            quat_conj(as_tuple4(joint_zero["rotation_wxyz"])),
            as_tuple4(zero["rotation_wxyz"]),
        )
        motor = axis_angle_quat((0.0, 0.0, 1.0), motor_angle(joint, time_s))
        child_current_pos = vec_add(
            quat_rotate(joint_current_rot, quat_rotate(motor, child_in_joint_pos)),
            joint_current_pos,
        )
        child_current_rot = quat_normalize(quat_mul(joint_current_rot, quat_mul(motor, child_in_joint_rot)))
        poses[body_id] = {
            "position_m": child_current_pos,
            "rotation_wxyz": child_current_rot,
        }
        return poses[body_id]

    for body in case["bodies"]:
        pose_of(body["id"])
    return poses


def assert_close(value, expected, tolerance=POSE_TOLERANCE):
    assert math.isfinite(value), value
    assert abs(value - expected) <= tolerance, (value, expected, tolerance)


def assert_vector_close(actual, expected, tolerance=POSE_TOLERANCE):
    assert len(actual) == len(expected), (actual, expected)
    for value, expected_value in zip(actual, expected):
        assert_close(value, expected_value, tolerance)


def assert_quaternion_equivalent(actual, expected, tolerance=POSE_TOLERANCE):
    assert len(actual) == 4, actual
    assert all(math.isfinite(value) for value in actual), actual
    norm = math.sqrt(sum(value * value for value in actual))
    assert_close(norm, 1.0, tolerance)
    dot = sum(value * expected_value for value, expected_value in zip(actual, expected))
    assert abs(abs(dot) - 1.0) <= tolerance, (actual, expected, dot)


def scheduled_sample_times(case):
    if case["duration_s"] == 1 and case["step_s"] == 0.1 and case["sample_every_steps"] == 5:
        return (0.0, 0.5, 1.0)
    if case["duration_s"] == 1 and case["step_s"] == 0.1 and case["sample_every_steps"] == 1:
        return tuple(index * 0.1 for index in range(11))
    raise AssertionError("smoke fixtures use the bounded 1s / 0.1s sample schedules")


def synthetic_completed_observation(case, times=None):
    sample_times = times if times is not None else scheduled_sample_times(case)
    samples = []
    for time_s in sample_times:
        poses = body_poses_at(case, time_s)
        samples.append({
            "time_s": time_s,
            "bodies": [
                {
                    "id": body["id"],
                    "position_m": list(poses[body["id"]]["position_m"]),
                    "rotation_wxyz": list(poses[body["id"]]["rotation_wxyz"]),
                }
                for body in case["bodies"]
            ],
            "motors": [
                {
                    "joint_id": joint["id"],
                    "declared_limit_observation": declared_limit_relation(joint, time_s),
                    "translation_residual_m": [0.0, 0.0, 0.0],
                    "rotation_quaternion_imag_residual": [0.0, 0.0, 0.0],
                    "motor_angle_rad": motor_angle(joint, time_s),
                }
                for joint in case["joints"]
            ],
        })
    return {
        "engine": {"name": "Project Chrono", "version": "10.0.0"},
        "runtime": {"binding": "pychrono", "python_version": "3.12.14"},
        "samples": samples,
        "not_evaluated": list(NOT_EVALUATED),
        "execution_state": "completed",
        "kinematics_exit": {"raw_code": 1, "raw_name": "SUCCESS"},
    }


def qualify_observation(case, observation, *, require_engine_identity=True):
    if require_engine_identity:
        assert observation["engine"] == {"name": "Project Chrono", "version": "10.0.0"}, observation
        assert observation["runtime"] == {"binding": "pychrono", "python_version": "3.12.14"}, observation
    assert observation["execution_state"] == "completed", observation
    successful_exits = {1: "SUCCESS", 2: "ABSTOL_RESIDUAL", 3: "RELTOL_UPDATE", 4: "ABSTOL_UPDATE"}
    exit_observation = observation["kinematics_exit"]
    assert exit_observation["raw_code"] in successful_exits, observation
    assert successful_exits[exit_observation["raw_code"]] == exit_observation["raw_name"], observation
    assert observation["not_evaluated"] == NOT_EVALUATED, observation
    samples = observation["samples"] if "samples" in observation else None
    if samples is None:
        raise AssertionError("qualify_observation requires full samples")
    expected_times = scheduled_sample_times(case)
    assert len(samples) == len(expected_times), (len(samples), expected_times)
    for sample, expected_time in zip(samples, expected_times):
        assert_close(sample["time_s"], expected_time)
        assert [body["id"] for body in sample["bodies"]] == [body["id"] for body in case["bodies"]], sample
        assert [motor["joint_id"] for motor in sample["motors"]] == [joint["id"] for joint in case["joints"]], sample
        poses = body_poses_at(case, sample["time_s"])
        for body in sample["bodies"]:
            assert_vector_close(body["position_m"], poses[body["id"]]["position_m"])
            assert_quaternion_equivalent(body["rotation_wxyz"], poses[body["id"]]["rotation_wxyz"])
        for motor, joint in zip(sample["motors"], case["joints"]):
            assert_close(motor["motor_angle_rad"], motor_angle(joint, sample["time_s"]))
            assert motor["declared_limit_observation"] == declared_limit_relation(joint, sample["time_s"]), motor
            for residual_name in ("translation_residual_m", "rotation_quaternion_imag_residual"):
                residual = motor[residual_name]
                assert len(residual) == 3 and all(math.isfinite(value) for value in residual), motor


def qualify_record_samples(case, record):
    observation = record["observation"]
    sample_page = record["sample_page"]
    samples = sample_page["samples"]
    assert sample_page["offset"] == 0, sample_page
    assert sample_page["total"] == observation["sample_count"], (sample_page, observation)
    assert sample_page["returned"] == len(samples), sample_page
    assert sample_page["has_more"] is False, sample_page
    payload = {
        "engine": observation["engine"],
        "runtime": observation["runtime"],
        "samples": samples,
        "not_evaluated": observation["not_evaluated"],
        "execution_state": observation["execution_state"],
        "kinematics_exit": observation["kinematics_exit"],
    }
    qualify_observation(case, payload)
    for previous, current in zip(samples, samples[1:]):
        assert current["time_s"] > previous["time_s"], samples


def qualify_native_fixture(rpc, fixture, request_id, timeout_ms=15000):
    case = fixture.case()
    encoded = case_json(case)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    submitted = rpc(None, "chrono_case_submit", {"case_json": encoded, "case_sha256": digest})
    assert submitted["ok"] is True, submitted
    assert submitted["case_sha256"] == digest, submitted
    case_readback = rpc(None, "chrono_case_get", {"case_sha256": digest})
    assert case_readback["ok"] is True, case_readback
    assert case_readback["case_sha256"] == digest, case_readback
    assert case_readback["case_uri"] == submitted["case_uri"], case_readback
    assert case_readback["case_json"] == encoded, case_readback
    run = rpc(None, "chrono_run_prescribed_kinematics", {
        "request_id": request_id,
        "case_sha256": digest,
        "case_uri": submitted["case_uri"],
        "timeout_ms": timeout_ms,
    })
    assert run["ok"] is True, run
    assert run["replayed"] is False, run
    record = run["record"]
    qualify_record_samples(case, record)
    receipt = record["receipt"]
    assert receipt["case_sha256"] == digest, receipt
    assert len(receipt["outcome_sha256"]) == 64, receipt
    assert len(receipt["receipt_sha256"]) == 64, receipt
    assert len(receipt["worker"]["source_sha256"]) == 64, receipt
    assert receipt["runtime"] == record["observation"]["runtime"], receipt
    assert receipt["server_runtime"] == {"deno_version": "2.9.6"}, receipt
    assert receipt["execution_state"] == record["observation"]["execution_state"], receipt
    assert receipt["kinematics_exit"] == record["observation"]["kinematics_exit"], receipt
    receipt_readback = rpc(None, "chrono_run_receipt_get", {
        "receipt_sha256": receipt["receipt_sha256"],
    })
    assert receipt_readback["ok"] is True, receipt_readback
    assert receipt_readback["record"] == record, receipt_readback
    return record


def qualify_zero_angle_reference(rpc, request_id="native-smoke-zero-angle-reference"):
    case = zero_angle_reference_case()
    encoded = case_json(case)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    submitted = rpc(None, "chrono_case_submit", {"case_json": encoded, "case_sha256": digest})
    assert submitted["ok"] is True, submitted
    run = rpc(None, "chrono_run_prescribed_kinematics", {
        "request_id": request_id,
        "case_sha256": digest,
        "case_uri": submitted["case_uri"],
        "timeout_ms": 15000,
    })
    assert run["ok"] is True, run
    page = run["record"]["sample_page"]
    assert page["offset"] == 0, page
    assert page["has_more"] is False, page
    t0 = page["samples"][0]
    assert_close(t0["time_s"], 0)
    assert_close(t0["motors"][0]["motor_angle_rad"], 0.5)
    assert_vector_close(t0["bodies"][1]["position_m"], [math.cos(0.5), math.sin(0.5), 0])
    assert_quaternion_equivalent(
        t0["bodies"][1]["rotation_wxyz"],
        [math.cos(0.25), 0, 0, math.sin(0.25)],
    )
    case_readback = rpc(None, "chrono_case_get", {"case_sha256": digest})
    assert case_readback["case_json"] == encoded, case_readback
    receipt = run["record"]["receipt"]
    receipt_readback = rpc(None, "chrono_run_receipt_get", {
        "receipt_sha256": receipt["receipt_sha256"],
    })
    assert receipt_readback["record"] == run["record"], receipt_readback
    return run["record"]


class HttpClient:
    def __init__(self, endpoint, token):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self._next_id = 1

    def request(self, path, payload=None, authenticated=True, mcp_method=None, mcp_name=None):
        headers = {}
        if authenticated:
            headers["Authorization"] = f"Bearer {self.token}"
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if mcp_method:
            headers["MCP-Protocol-Version"] = PROTO
            headers["Mcp-Method"] = mcp_method
        if mcp_name:
            headers["Mcp-Name"] = mcp_name
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        return urllib.request.urlopen(
            urllib.request.Request(self.endpoint + path, data=body, headers=headers),
            timeout=20,
        )

    def rpc(self, request_id, tool_name, arguments):
        del request_id
        rpc_id = self._next_id
        self._next_id += 1
        response = self.request(
            "/mcp",
            {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments,
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": PROTO,
                        "io.modelcontextprotocol/clientCapabilities": {},
                        "io.modelcontextprotocol/clientInfo": {
                            "name": "mcp-chrono-native-smoke",
                            "version": "1",
                        },
                    },
                },
            },
            mcp_method="tools/call",
            mcp_name=tool_name,
        )
        return json.load(response)["result"]["structuredContent"]


class StdioClient:
    def __init__(self, command, timeout_s=120):
        self.command = list(command)
        self.timeout_s = timeout_s
        self._proc = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._stderr = bytearray()
        self._closed = False
        self._next_id = 1
        self._drain = threading.Thread(target=self._drain_stderr, daemon=True)
        self._drain.start()

    def _drain_stderr(self):
        assert self._proc.stderr is not None
        while True:
            chunk = self._proc.stderr.read(4096)
            if not chunk:
                return
            self._stderr.extend(chunk)

    def _readline(self):
        assert self._proc.stdout is not None
        fd = self._proc.stdout.fileno()
        ready, _, _ = select.select([fd], [], [], self.timeout_s)
        if not ready:
            raise AssertionError(
                f"stdio smoke timed out: {bytes(self._stderr).decode(errors='replace')}"
            )
        line = self._proc.stdout.readline()
        if not line:
            raise AssertionError(
                f"stdio smoke ended before a response: {bytes(self._stderr).decode(errors='replace')}"
            )
        return line

    def rpc(self, request_id, tool_name, arguments):
        del request_id
        if self._proc.stdin is None:
            raise AssertionError("stdio stdin is unavailable")
        rpc_id = self._next_id
        self._next_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": PROTO,
                    "io.modelcontextprotocol/clientCapabilities": {},
                    "io.modelcontextprotocol/clientInfo": {
                        "name": "mcp-chrono-native-stdio-smoke",
                        "version": "1",
                    },
                },
            },
        }
        self._proc.stdin.write((json.dumps(payload, separators=(",", ":")) + "\n").encode())
        self._proc.stdin.flush()
        response = json.loads(self._readline())
        assert response.get("id") == rpc_id, response
        assert "error" not in response, response
        return response["result"]["structuredContent"]

    def close(self):
        if self._closed:
            return
        self._closed = True
        if self._proc.stdin and not self._proc.stdin.closed:
            self._proc.stdin.close()
        try:
            self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait(timeout=5)
        self._drain.join(timeout=1)
        if self._proc.stdout is not None and not self._proc.stdout.closed:
            self._proc.stdout.close()
        if self._proc.stderr is not None and not self._proc.stderr.closed:
            self._proc.stderr.close()


def assert_http_auth_boundary(endpoint, token):
    client = HttpClient(endpoint, token)
    try:
        client.request("/healthz", authenticated=False)
        raise AssertionError("health endpoint accepted a missing bearer token")
    except urllib.error.HTTPError as error:
        try:
            assert error.code == 401, error.code
            assert error.headers.get("WWW-Authenticate") == 'Bearer realm="mcp-chrono"', error.headers
        finally:
            error.close()


def _qualify_common(rpc, request_prefix=""):
    records = {}
    for fixture in native_fixtures():
        request_id = f"{request_prefix}{fixture.request_id}" if request_prefix else fixture.request_id
        records[fixture.name] = qualify_native_fixture(rpc, fixture, request_id)
    zero_id = f"{request_prefix}native-smoke-zero-angle-reference" if request_prefix else "native-smoke-zero-angle-reference"
    records["zero-angle-reference"] = qualify_zero_angle_reference(rpc, zero_id)
    return records


def qualify_http(port, token):
    endpoint = f"http://127.0.0.1:{port}"
    assert_http_auth_boundary(endpoint, token)
    client = HttpClient(endpoint, token)
    records = _qualify_common(client.rpc)
    one_joint = native_fixtures()[0]
    encoded = case_json(one_joint.case())
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    submitted = client.rpc(None, "chrono_case_submit", {"case_json": encoded, "case_sha256": digest})
    replay = client.rpc(None, "chrono_run_prescribed_kinematics", {
        "request_id": one_joint.request_id,
        "case_sha256": digest,
        "case_uri": submitted["case_uri"],
        "timeout_ms": 15000,
    })
    assert replay["ok"] is True and replay["replayed"] is True, replay
    assert replay["record"] == records["one-joint"], replay
    readback = client.rpc(None, "chrono_run_get", {"request_id": one_joint.request_id})
    assert readback["ok"] is True and readback["state"] == "recorded", readback
    assert readback["record"] == records["one-joint"], readback
    conflict = client.rpc(None, "chrono_run_prescribed_kinematics", {
        "request_id": one_joint.request_id,
        "case_sha256": "0" * 64,
        "timeout_ms": 15000,
    })
    assert conflict["ok"] is False, conflict
    assert conflict["error"]["code"] == "request_conflict", conflict
    return records


def qualify_stdio(command):
    client = StdioClient(command)
    try:
        return _qualify_common(client.rpc)
    finally:
        client.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Qualify bounded native Chrono smoke fixtures.")
    sub = parser.add_subparsers(dest="mode", required=True)
    http = sub.add_parser("http")
    http.add_argument("--port", required=True)
    http.add_argument("--token", required=True)
    stdio = sub.add_parser("stdio")
    stdio.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.mode == "http":
        qualify_http(args.port, args.token)
        return 0
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("stdio requires a container command after `--`")
    qualify_stdio(command)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except argparse.ArgumentError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2) from error
