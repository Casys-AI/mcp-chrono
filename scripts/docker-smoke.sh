#!/usr/bin/env sh
set -eu

image="${1:?image tag required}"
container="mcp-chrono-smoke-$$"
token="$(openssl rand -hex 32)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run --rm -d --name "$container" \
  -e MCP_BEARER_TOKEN="$token" \
  -p 127.0.0.1::3025 \
  "$image" >/dev/null

for _ in $(seq 1 45); do
  port="$(docker port "$container" 3025/tcp | sed 's/.*://')"
  if [ -n "$port" ] && curl --fail --silent \
    -H "Authorization: Bearer $token" \
    "http://127.0.0.1:$port/healthz" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 1
done

if [ -z "${port:-}" ] || ! curl --fail --silent \
  -H "Authorization: Bearer $token" \
  "http://127.0.0.1:$port/healthz" | grep -q '"status":"ok"'; then
  docker logs "$container" >&2
  exit 1
fi

python3 - "$port" "$token" <<'PY'
import hashlib
import json
import math
import sys
import urllib.error
import urllib.request

port, token = sys.argv[1:]
endpoint = f"http://127.0.0.1:{port}"
proto = "2026-07-28"

def request(path, payload=None, authenticated=True, mcp_method=None, mcp_name=None):
    headers = {}
    if authenticated:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if mcp_method:
        headers["MCP-Protocol-Version"] = proto
        headers["Mcp-Method"] = mcp_method
    if mcp_name:
        headers["Mcp-Name"] = mcp_name
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    return urllib.request.urlopen(
        urllib.request.Request(endpoint + path, data=body, headers=headers), timeout=20
    )

try:
    request("/healthz", authenticated=False)
    raise AssertionError("health endpoint accepted a missing bearer token")
except urllib.error.HTTPError as error:
    assert error.code == 401, error.code
    assert error.headers.get("WWW-Authenticate") == 'Bearer realm="mcp-chrono"', error.headers

def rpc(request_id, tool_name, arguments):
    response = request(
        "/mcp",
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": proto,
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

case = {
    "schema_id": "chrono-prescribed-kinematics-case/1.0",
    "units": {"length": "m", "angle": "rad", "time": "s"},
    "frame": {"handedness": "right"},
    "bodies": [
        {"id": "root", "fixed": True, "absolute_com_pose": {"position_m": [0, 0, 0], "rotation_wxyz": [1, 0, 0, 0]}},
        {"id": "arm", "fixed": False, "absolute_com_pose": {"position_m": [1, 0, 0], "rotation_wxyz": [1, 0, 0, 0]}},
    ],
    "joints": [{
        "id": "hinge", "parent_body": "root", "child_body": "arm",
        "absolute_joint_frame": {"position_m": [0, 0, 0], "rotation_wxyz": [1, 0, 0, 0]},
        "angle_ramp": {"initial_angle_rad": 0, "angular_speed_rad_s": math.pi / 2},
        "limits_rad": [-math.pi / 2, math.pi / 2],
    }],
    "duration_s": 1, "step_s": 0.1, "sample_every_steps": 5,
}
case_json = json.dumps(case, separators=(",", ":"))
case_sha256 = hashlib.sha256(case_json.encode()).hexdigest()
submitted = rpc(1, "chrono_case_submit", {"case_json": case_json, "case_sha256": case_sha256})
assert submitted["ok"] is True, submitted
request_id = "native-smoke-one-joint"
run = rpc(2, "chrono_run_prescribed_kinematics", {
    "request_id": request_id, "case_sha256": case_sha256,
    "case_uri": submitted["case_uri"], "timeout_ms": 15000,
})
assert run["ok"] is True, run
assert run["replayed"] is False, run
output = run["record"]["observation"]
assert output["engine"] == {"name": "Project Chrono", "version": "10.0.0"}, output
assert output["execution_state"] == "completed", output
assert output["not_evaluated"] == [
    "collision", "clearance", "contact", "forces", "torques", "dynamics",
    "strength", "safety", "product fitness",
], output

def assert_close(value, expected, tolerance=1e-5):
    assert math.isfinite(value), value
    assert abs(value - expected) <= tolerance, (value, expected, tolerance)

def assert_vector(actual, expected, tolerance=1e-5):
    assert len(actual) == len(expected), (actual, expected)
    for value, expected_value in zip(actual, expected):
        assert_close(value, expected_value, tolerance)

def assert_quaternion_equivalent(actual, expected, tolerance=1e-5):
    assert len(actual) == 4, actual
    assert all(math.isfinite(value) for value in actual), actual
    norm = math.sqrt(sum(value * value for value in actual))
    assert_close(norm, 1.0, tolerance)
    dot = sum(value * expected_value for value, expected_value in zip(actual, expected))
    assert abs(abs(dot) - 1.0) <= tolerance, (actual, expected, dot)

sample_page = run["record"]["sample_page"]
samples = sample_page["samples"]
assert sample_page["offset"] == 0, sample_page
assert sample_page["total"] == output["sample_count"], (sample_page, output)
assert sample_page["returned"] == len(samples), sample_page
assert sample_page["has_more"] is False, sample_page
assert len(samples) >= 2, samples
assert_close(samples[0]["time_s"], 0.0)
assert_close(samples[-1]["time_s"], case["duration_s"])
for previous, current in zip(samples, samples[1:]):
    assert current["time_s"] > previous["time_s"], samples
for sample in samples:
    assert math.isfinite(sample["time_s"]), sample
    assert [body["id"] for body in sample["bodies"]] == ["root", "arm"], sample
    assert len(sample["bodies"]) == 2, sample
    assert [motor["joint_id"] for motor in sample["motors"]] == ["hinge"], sample
    assert len(sample["motors"]) == 1, sample
    for body in sample["bodies"]:
        assert len(body["position_m"]) == 3, body
        assert len(body["rotation_wxyz"]) == 4, body
        assert all(math.isfinite(value) for value in body["position_m"]), body
        assert all(math.isfinite(value) for value in body["rotation_wxyz"]), body
    motor = sample["motors"][0]
    assert motor["declared_limit_observation"] == "within", motor
    assert "motor_angle_rad" in motor, motor
    assert math.isfinite(motor["motor_angle_rad"]), motor
    for residual_name in (
        "translation_residual_m",
        "rotation_quaternion_imag_residual",
    ):
        residual = motor[residual_name]
        assert len(residual) == 3 and all(math.isfinite(value) for value in residual), motor

t0 = samples[0]
assert_vector(t0["bodies"][0]["position_m"], [0, 0, 0])
assert_quaternion_equivalent(t0["bodies"][0]["rotation_wxyz"], [1, 0, 0, 0])
# The off-axis CoM makes this an actual pose check after t=0 assembly.
assert_vector(t0["bodies"][1]["position_m"], [1, 0, 0])
assert_quaternion_equivalent(t0["bodies"][1]["rotation_wxyz"], [1, 0, 0, 0])

final = samples[-1]
assert_vector(final["bodies"][0]["position_m"], [0, 0, 0])
assert_quaternion_equivalent(final["bodies"][0]["rotation_wxyz"], [1, 0, 0, 0])
assert_vector(final["bodies"][1]["position_m"], [0, 1, 0])
assert_quaternion_equivalent(
    final["bodies"][1]["rotation_wxyz"],
    [math.sqrt(0.5), 0, 0, math.sqrt(0.5)],
)
assert_close(final["motors"][0]["motor_angle_rad"], math.pi / 2)
assert final["motors"][0]["declared_limit_observation"] == "within", final

zero_angle_reference_case = {
    "schema_id": "chrono-prescribed-kinematics-case/1.0",
    "units": {"length": "m", "angle": "rad", "time": "s"},
    "frame": {"handedness": "right"},
    "bodies": [
        {"id": "root", "fixed": True, "absolute_com_pose": {"position_m": [0, 0, 0], "rotation_wxyz": [1, 0, 0, 0]}},
        {"id": "arm", "fixed": False, "absolute_com_pose": {"position_m": [1, 0, 0], "rotation_wxyz": [1, 0, 0, 0]}},
    ],
    "joints": [{
        "id": "hinge", "parent_body": "root", "child_body": "arm",
        "absolute_joint_frame": {"position_m": [0, 0, 0], "rotation_wxyz": [1, 0, 0, 0]},
        "angle_ramp": {"initial_angle_rad": 0.5, "angular_speed_rad_s": 0},
        "limits_rad": [-1, 1],
    }],
    "duration_s": 1, "step_s": 0.1, "sample_every_steps": 1,
}
zero_angle_reference_json = json.dumps(zero_angle_reference_case, separators=(",", ":"))
zero_angle_reference_sha256 = hashlib.sha256(zero_angle_reference_json.encode()).hexdigest()
zero_angle_reference_submitted = rpc(6, "chrono_case_submit", {
    "case_json": zero_angle_reference_json,
    "case_sha256": zero_angle_reference_sha256,
})
assert zero_angle_reference_submitted["ok"] is True, zero_angle_reference_submitted
zero_angle_reference_run = rpc(7, "chrono_run_prescribed_kinematics", {
    "request_id": "native-smoke-zero-angle-reference",
    "case_sha256": zero_angle_reference_sha256,
    "case_uri": zero_angle_reference_submitted["case_uri"], "timeout_ms": 15000,
})
assert zero_angle_reference_run["ok"] is True, zero_angle_reference_run
zero_angle_reference_page = zero_angle_reference_run["record"]["sample_page"]
assert zero_angle_reference_page["offset"] == 0, zero_angle_reference_page
assert zero_angle_reference_page["has_more"] is False, zero_angle_reference_page
zero_angle_reference_t0 = zero_angle_reference_page["samples"][0]
assert_close(zero_angle_reference_t0["time_s"], 0)
assert_close(zero_angle_reference_t0["motors"][0]["motor_angle_rad"], 0.5)
assert_vector(
    zero_angle_reference_t0["bodies"][1]["position_m"],
    [math.cos(0.5), math.sin(0.5), 0],
)
assert_quaternion_equivalent(
    zero_angle_reference_t0["bodies"][1]["rotation_wxyz"],
    [math.cos(0.25), 0, 0, math.sin(0.25)],
)

replay = rpc(3, "chrono_run_prescribed_kinematics", {
    "request_id": request_id, "case_sha256": case_sha256,
    "case_uri": submitted["case_uri"], "timeout_ms": 15000,
})
assert replay["ok"] is True and replay["replayed"] is True, replay
assert replay["record"] == run["record"], replay
readback = rpc(4, "chrono_run_get", {"request_id": request_id})
assert readback["ok"] is True and readback["state"] == "recorded", readback
assert readback["record"] == run["record"], readback
conflict = rpc(5, "chrono_run_prescribed_kinematics", {
    "request_id": request_id, "case_sha256": "0" * 64, "timeout_ms": 15000,
})
assert conflict["ok"] is False, conflict
assert conflict["error"]["code"] == "request_conflict", conflict
PY
