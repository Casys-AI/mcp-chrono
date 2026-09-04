# Provider contract

## Scope

`chrono-prescribed-kinematics-case/1.0` describes explicit prescribed rigid-body
kinematics in metres, radians and seconds using a right-handed frame. A case contains
named bodies with absolute zero-angle centre-of-mass reference poses, one fixed root,
and a connected acyclic tree of revolute angle motors.

Every joint declares an absolute zero-angle joint frame, a linear angle ramp and angular
limits. The worker applies `initial_angle_rad` during assembly before publishing the
observed `t=0` sample. That sample can therefore differ from the submitted zero-angle
reference pose.

The schema does not cover prismatic joints, nonlinear profiles, contact, forces or
dynamics. The provider does not know Digital Thread projects, SysML requirements, MRTR
decisions, verification gates or product verdicts.

## Case and run lifecycle

Start with `chrono_manifest_get`. It returns the complete JSON Schema, units,
cross-field invariants, a non-executing example and the result-page contract.
`chrono_case_template_get` returns that example and its invariants.

`chrono_case_submit` accepts `case_json` as exact UTF-8. An optional lower-case
`case_sha256` acts only as an expected digest; the server always computes the
authoritative digest and stores the original bytes under `chrono-case:sha256:<digest>`.

`chrono_run_prescribed_kinematics` reopens and rehashes the stored case before calling
the fixed worker. It persists intent first, then atomically publishes the run record,
ledger binding and output. Its canonical receipt binds:

- case and outcome digests;
- request identity and recorded time;
- package, provider, worker, Python and Deno runtime identities;
- literal execution state and native kinematics exit.

Retrying an exact recorded request reuses it. Reusing the request ID for another case is
a conflict. A persisted intent without a result remains `uncertain` and is never rerun
automatically.

`chrono_case_get`, `chrono_run_get` and `chrono_run_receipt_get` are identity readbacks.
Run readbacks contain an observation summary and a bounded `sample_page`; advance
`sample_offset` while `has_more` is true.

## Literal states

`completed` and `not_converged` are engine observations. `absent`, `uncertain`,
`unavailable`, `unresolved`, `unsupported` and `corrupt` retain their literal meaning.
None of them is promoted to an engineering or product verdict.

The `not_evaluated` list is authoritative: collision, clearance, contact, forces,
torques, dynamics, strength, safety and product fitness remain outside this provider. An
observed declared-limit relation is not a requirement judgement.

## Bounds

Inputs reject unknown object properties. Case JSON is bounded to 512 KiB UTF-8, with
bounded bodies, joints, duration, integration steps and stored samples. MCP readback is
paged independently. Exact limits live in the JSON Schema returned by
`chrono_manifest_get`; clients should consume that schema rather than duplicate them.

## Compatibility

Recorded receipts are version-attested. Source version 0.3.4 reads only exact 0.3.4
records and fails closed on older persisted formats. It never rewrites or relabels old
bytes as current evidence.

The HTTP transport uses the Casys MCP discovery dialect implemented by
`@casys/mcp-server`. This is not an OAuth issuer or token service.
