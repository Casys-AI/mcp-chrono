import type { ChronoRunner } from "../../application/service.ts";
import { ChronoError } from "../../domain/errors.ts";
import { sha256Bytes } from "../../domain/sha.ts";
import {
  CHRONO_VERSION,
  type PrescribedKinematicsCase,
  type RunExecution,
} from "../../domain/types.ts";

const MAX_WORKER_OUTPUT = 4 * 1024 * 1024;
const MAX_WORKER_ERROR = 64 * 1024;
const NOT_EVALUATED = [
  "collision",
  "clearance",
  "contact",
  "forces",
  "torques",
  "dynamics",
  "strength",
  "safety",
  "product fitness",
] as const;
const EXIT_FLAG_NAMES: Readonly<Record<number, string>> = {
  0: "NOT_CONVERGED",
  1: "SUCCESS",
  2: "ABSTOL_RESIDUAL",
  3: "RELTOL_UPDATE",
  4: "ABSTOL_UPDATE",
};

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChronoError("worker_invalid_output", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  if (
    Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))
  ) {
    throw new ChronoError("worker_invalid_output", `${path} has an invalid shape.`);
  }
}
function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ChronoError("worker_invalid_output", `${path} must be finite.`);
  }
  return value;
}
function triple(value: unknown, path: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ChronoError("worker_invalid_output", `${path} must be a triple.`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}
function quaternion(value: unknown, path: string): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ChronoError("worker_invalid_output", `${path} must be a quaternion.`);
  }
  const result: [number, number, number, number] = [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
    finite(value[3], `${path}[3]`),
  ];
  if (Math.abs(Math.hypot(...result) - 1) > 1e-5) {
    throw new ChronoError("worker_invalid_output", `${path} must be normalized.`);
  }
  return result;
}
async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  code: "worker_output_too_large" | "worker_stderr_too_large",
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ChronoError(code, "Chrono worker exceeded a bounded output pipe.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Fixed native boundary: no caller-selected scripts, paths, or arguments. */
export class ChronoWorkerRunner implements ChronoRunner {
  constructor(
    private readonly workerPath: string =
      new URL("../../../scripts/chrono_worker.py", import.meta.url).pathname,
    private readonly python: string = Deno.env.get("CHRONO_PYTHON") ?? "python3",
  ) {}
  async run(
    caseData: PrescribedKinematicsCase,
    timeoutMs: number,
  ): Promise<RunExecution> {
    const worker = {
      source_sha256: await sha256Bytes(await Deno.readFile(this.workerPath)),
    };
    const child = new Deno.Command(this.python, {
      args: [this.workerPath],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const status = child.status;
    const write = (async (): Promise<void> => {
      const writer = child.stdin.getWriter();
      try {
        await writer.write(new TextEncoder().encode(JSON.stringify(caseData)));
      } finally {
        await writer.close();
      }
    })();
    const stdout = readBounded(
      child.stdout,
      MAX_WORKER_OUTPUT,
      "worker_output_too_large",
    );
    const stderr = readBounded(
      child.stderr,
      MAX_WORKER_ERROR,
      "worker_stderr_too_large",
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed: [void, Uint8Array, Uint8Array, Deno.CommandStatus] =
        await Promise.race([
          Promise.all([write, stdout, stderr, status]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new ChronoError("runner_timeout", "Chrono worker timed out."));
            }, timeoutMs);
          }),
        ]);
      const [, out, err, exit] = completed;
      if (!exit.success) {
        throw new ChronoError("worker_failed", "Chrono worker exited unsuccessfully.", {
          code: exit.code,
          stderr: new TextDecoder().decode(err),
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(out));
      } catch {
        throw new ChronoError(
          "worker_invalid_output",
          "Chrono worker returned invalid JSON.",
        );
      }
      return { observation: this.validateObservation(parsed, caseData), worker };
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch { /* process already exited */ }
      await Promise.allSettled([write, stdout, stderr, status]);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  private validateObservation(
    value: unknown,
    input: PrescribedKinematicsCase,
  ): RunExecution["observation"] {
    const top = object(value, "worker output");
    exactKeys(top, [
      "engine",
      "runtime",
      "samples",
      "not_evaluated",
      "execution_state",
      "kinematics_exit",
    ], "worker output");
    const engine = object(top.engine, "engine");
    exactKeys(engine, ["name", "version"], "engine");
    if (engine.name !== "Project Chrono" || engine.version !== CHRONO_VERSION) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker engine identity is not Project Chrono 10.0.0.",
      );
    }
    const runtime = object(top.runtime, "runtime");
    exactKeys(runtime, ["binding", "python_version"], "runtime");
    if (
      runtime.binding !== "pychrono" || typeof runtime.python_version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(runtime.python_version)
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker runtime identity is invalid.",
      );
    }
    if (
      !Array.isArray(top.not_evaluated) ||
      top.not_evaluated.length !== NOT_EVALUATED.length ||
      top.not_evaluated.some((value, index) => value !== NOT_EVALUATED[index])
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker not_evaluated boundary is invalid.",
      );
    }
    if (
      top.execution_state !== "completed" && top.execution_state !== "not_converged"
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker execution_state is invalid.",
      );
    }
    const exit = object(top.kinematics_exit, "kinematics_exit");
    exactKeys(exit, ["raw_code", "raw_name"], "kinematics_exit");
    if (!Number.isInteger(exit.raw_code) || !Number.isFinite(exit.raw_code)) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker raw exit code is invalid.",
      );
    }
    if (typeof exit.raw_name !== "string") {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker raw exit name is invalid.",
      );
    }
    if (
      EXIT_FLAG_NAMES[exit.raw_code as number] !== exit.raw_name
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker raw exit code and name are inconsistent.",
      );
    }
    if (
      (top.execution_state === "not_converged") !== (exit.raw_name === "NOT_CONVERGED")
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker execution_state contradicts raw exit state.",
      );
    }
    if (
      !Array.isArray(top.samples) || top.samples.length < 1 || top.samples.length > 512
    ) {
      throw new ChronoError("worker_invalid_output", "Worker sample count is invalid.");
    }
    const samples = top.samples.map((value, sampleIndex) => {
      const sample = object(value, `samples[${sampleIndex}]`);
      exactKeys(sample, ["time_s", "bodies", "motors"], `samples[${sampleIndex}]`);
      const time_s = finite(sample.time_s, `samples[${sampleIndex}].time_s`);
      if (
        !Array.isArray(sample.bodies) || sample.bodies.length !== input.bodies.length
      ) {
        throw new ChronoError(
          "worker_invalid_output",
          "Worker body cardinality is invalid.",
        );
      }
      if (
        !Array.isArray(sample.motors) || sample.motors.length !== input.joints.length
      ) {
        throw new ChronoError(
          "worker_invalid_output",
          "Worker motor cardinality is invalid.",
        );
      }
      const bodies = sample.bodies.map((value, bodyIndex) => {
        const body = object(value, `samples[${sampleIndex}].bodies[${bodyIndex}]`);
        exactKeys(
          body,
          ["id", "position_m", "rotation_wxyz"],
          `samples[${sampleIndex}].bodies[${bodyIndex}]`,
        );
        if (body.id !== input.bodies[bodyIndex].id) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker body identity is invalid.",
          );
        }
        return {
          id: body.id,
          position_m: triple(body.position_m, "body.position_m"),
          rotation_wxyz: quaternion(body.rotation_wxyz, "body.rotation_wxyz"),
        };
      });
      const motors = sample.motors.map((value, jointIndex) => {
        const motor = object(value, `samples[${sampleIndex}].motors[${jointIndex}]`);
        const allowed = [
          "joint_id",
          "declared_limit_observation",
          "translation_residual_m",
          "rotation_quaternion_imag_residual",
          "motor_angle_rad",
        ];
        if (
          Object.keys(motor).some((key) => !allowed.includes(key)) ||
          [
            "joint_id",
            "declared_limit_observation",
            "translation_residual_m",
            "rotation_quaternion_imag_residual",
          ].some((key) => !(key in motor))
        ) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker motor shape is invalid.",
          );
        }
        if (motor.joint_id !== input.joints[jointIndex].id) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker motor identity is invalid.",
          );
        }
        if (
          motor.declared_limit_observation !== "below" &&
          motor.declared_limit_observation !== "within" &&
          motor.declared_limit_observation !== "above"
        ) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker limit observation is invalid.",
          );
        }
        const declared_limit_observation = motor.declared_limit_observation as
          | "below"
          | "within"
          | "above";
        if (!("motor_angle_rad" in motor)) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker must report every observed motor angle.",
          );
        }
        const motor_angle_rad = finite(motor.motor_angle_rad, "motor.motor_angle_rad");
        const observedAngle = motor_angle_rad;
        const [lower, upper] = input.joints[jointIndex].limits_rad;
        const expectedRelation = observedAngle < lower
          ? "below"
          : observedAngle > upper
          ? "above"
          : "within";
        if (declared_limit_observation !== expectedRelation) {
          throw new ChronoError(
            "worker_invalid_output",
            "Worker declared-limit observation contradicts its reported angle.",
          );
        }
        return {
          joint_id: motor.joint_id,
          declared_limit_observation,
          translation_residual_m: triple(
            motor.translation_residual_m,
            "motor.translation_residual_m",
          ),
          rotation_quaternion_imag_residual: triple(
            motor.rotation_quaternion_imag_residual,
            "motor.rotation_quaternion_imag_residual",
          ),
          motor_angle_rad,
        };
      });
      return { time_s, bodies, motors };
    });
    if (samples[0].time_s !== 0) {
      throw new ChronoError(
        "worker_invalid_output",
        "Worker samples must begin at t=0.",
      );
    }
    for (let index = 1; index < samples.length; index++) {
      if (!(samples[index].time_s > samples[index - 1].time_s)) {
        throw new ChronoError(
          "worker_invalid_output",
          "Worker sample times are not strictly ordered.",
        );
      }
    }
    if (
      top.execution_state === "completed" &&
      Math.abs(samples.at(-1)!.time_s - input.duration_s) > 1e-9
    ) {
      throw new ChronoError(
        "worker_invalid_output",
        "Completed worker output must include final time.",
      );
    }
    const execution_state = top.execution_state as "completed" | "not_converged";
    const raw_code = exit.raw_code as number;
    const raw_name = exit.raw_name as string;
    return {
      engine: { name: "Project Chrono", version: CHRONO_VERSION },
      runtime: {
        binding: "pychrono",
        python_version: runtime.python_version,
      },
      samples,
      not_evaluated: NOT_EVALUATED,
      execution_state,
      kinematics_exit: { raw_code, raw_name },
    };
  }
}
