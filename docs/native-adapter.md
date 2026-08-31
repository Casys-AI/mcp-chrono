# Native adapter boundary

The fixed worker constructs `ChSystemNSC` with zero gravity and collision disabled. It
creates one `ChLinkMotorRotationAngle` for each explicitly declared revolute motor and
does not add a second revolute constraint.

Reference body and joint poses describe the absolute zero-angle configuration. During
assembly the worker installs `initial_angle_rad` and calls `DoStepKinematics(0)`, so the
observed initial sample is the assembled configuration rather than a relabelled input
pose.

The time loop is bounded by a planned step count. Interior steps use
`min(step, target - current)` and the last planned step consumes the actual positive
remainder. Published sample times come only from `GetChTime()`; they are never replaced
with the requested target to hide floating-point drift.

Native exit data stays literal. `NOT_CONVERGED` becomes
`execution_state: "not_converged"`; it is not converted to success. Constraint
observations keep translation residuals in metres separate from quaternion-imaginary
rotation residuals.

The container smoke is the native qualification oracle. Unit tests with an injected
runner prove provider orchestration and validation, not PyChrono execution.

The image removes unused Chrono datasets and PyChrono demos after validating the pinned
package metadata and required core symbols. Those removed assets and modules that need
them are outside provider coverage. Final-image checks preserve the exact Conda recipes,
licences, Ubuntu notices and cached npm package metadata required by the distribution
boundary.
