import { assert, assertEquals } from "@std/assert";

const root = new URL("..", import.meta.url).pathname;
async function text(path: string) {
  return await Deno.readTextFile(`${root}/${path}`);
}
Deno.test("release pins and package version stay explicit", async () => {
  const dockerfile = await text("Dockerfile");
  const deno = JSON.parse(await text("deno.json"));
  assert(
    dockerfile.includes(
      "mambaorg/micromamba@sha256:2681c45bf145f9b292fc26120646125586a2be4289eda48ce8a94ae2b22eda67",
    ),
  );
  assert(
    dockerfile.includes(
      "denoland/deno:bin-2.9.2@sha256:5ab209e42a062db554ebc7598409b4a43467d7911e2cdee6176a0b4efc67738f",
    ),
  );
  assert(
    dockerfile.includes(
      "locks/pychrono-linux-64.explicit.txt",
    ),
  );
  assert(dockerfile.includes("deno cache --frozen"));
  assert(!dockerfile.includes("importlib.metadata"));
  assert(
    dockerfile.includes(
      "/opt/conda/conda-meta/pychrono-10.0.0-py312h98ab86c_677.json",
    ),
  );
  assert(!dockerfile.includes("CHRONO_VERSION"));
  assert(dockerfile.includes('metadata["name"] == "pychrono"'));
  assert(dockerfile.includes('metadata["version"] == "10.0.0"'));
  assert(dockerfile.includes('metadata["build"] == "py312h98ab86c_677"'));
  assert(dockerfile.includes('"ChSystemNSC"'));
  assert(dockerfile.includes('"GetMotorAngle"'));
  const lock = await text("locks/pychrono-linux-64.explicit.txt");
  assert(
    lock.includes(
      "pychrono-10.0.0-py312h98ab86c_677.conda#87d7e06a15f660525714f1e368145a881ad9e0495dabfd821b105096450f841e",
    ),
  );
  assertEquals(deno.version, "0.1.0");
  const types = await text("src/domain/types.ts");
  assert(types.includes('CHRONO_VERSION = "10.0.0"'));
  assert(types.includes(`PROVIDER_VERSION = "${deno.version}"`));
  assert((await text("src/server.ts")).includes("version: PROVIDER_VERSION"));
});
Deno.test("release workflow requires explicit artifact clearance and does not publish latest", async () => {
  const release = await text(".github/workflows/release.yml");
  const deno = await text("deno.json");
  const dockerignore = await text(".dockerignore");
  const gitignore = await text(".gitignore");
  const dockerSmoke = await text("scripts/docker-smoke.sh");
  const manifest = await text("src/tools/register.ts");
  const readme = await text("README.md");
  assert(release.includes("refs/tags/v"));
  assert(!release.includes(":latest"));
  assert(release.includes('test "$GITHUB_REF_NAME" = "v$version"'));
  assert(release.includes("deno publish --dry-run"));
  const publishJob = release.slice(release.indexOf("  publish:"));
  assert(
    publishJob.includes("if: vars.CHRONO_RELEASE_ENABLED == 'true'"),
  );
  assert(publishJob.includes("deno publish"));
  assert(publishJob.includes("docker/login-action"));
  assert(publishJob.includes("push: true"));
  assert(!release.includes("--allow-slow-types"));
  assert(!deno.includes("--allow-slow-types"));
  assert(deno.includes("container_entrypoint_test.py"));
  for (const pattern of [".env", ".env.*", "**/.env", "**/.env.*"]) {
    assert(dockerignore.includes(pattern), `missing Docker ignore ${pattern}`);
  }
  for (
    const pattern of [
      ".env",
      ".env.*",
      "*.env",
      "*.env.*",
      "**/.env",
      "**/.env.*",
      "**/*.env",
      "**/*.env.*",
    ]
  ) {
    assert(gitignore.includes(pattern), `missing Git ignore ${pattern}`);
  }
  assert(gitignore.includes("!**/.env.example"));
  assert(
    manifest.includes(
      "0.1.0 prepared; JSR package and GHCR image unpublished",
    ),
  );
  assert(readme.includes("CHRONO_RELEASE_ENABLED"));
  assert(readme.includes("explicit artifact clearance"));
  assert(dockerSmoke.includes("native-smoke-zero-angle-reference"));
  assert(dockerSmoke.includes('"initial_angle_rad": 0.5'));
  assert(dockerSmoke.includes("[math.cos(0.5), math.sin(0.5), 0]"));
  assert(
    dockerSmoke.includes("[math.cos(0.25), 0, 0, math.sin(0.25)]"),
  );
});

Deno.test("container proxy keeps its bearer boundary and bounded child fallback", async () => {
  const entrypoint = await text("scripts/container_entrypoint.py");
  assert(entrypoint.includes("BEARER_CHALLENGE"));
  assert(entrypoint.includes('"WWW-Authenticate", BEARER_CHALLENGE'));
  assert(entrypoint.includes('self.reject(400, "Invalid Content-Length")'));
  assert(entrypoint.includes("def handle_expect_100"));
  assert(entrypoint.includes('"Connection", "close"'));
  assert(entrypoint.includes('"Transfer-Encoding is not supported"'));
  assert(entrypoint.includes('"Duplicate Content-Length"'));
  assert(entrypoint.includes('"Duplicate Authorization"'));
  assert(entrypoint.includes("CLIENT_READ_TIMEOUT_S"));
  assert(entrypoint.includes("MAX_CONCURRENT_CLIENTS"));
  assert(entrypoint.includes("class BoundedThreadingHTTPServer"));
  assert(entrypoint.includes("except BaseException"));
  assert(entrypoint.includes("self._request_slots.release()"));
  assert(entrypoint.includes('"Incomplete request body"'));
  assert(entrypoint.includes('"Request body timeout"'));
  assert(entrypoint.includes("except http.client.HTTPException"));
  assert(entrypoint.includes("def stop_child"));
  assert(entrypoint.includes("except subprocess.TimeoutExpired"));
  assert(entrypoint.includes('"authorization",'));
  const signalHandler = entrypoint.slice(
    entrypoint.indexOf("def request_stop"),
    entrypoint.indexOf("signal.signal", entrypoint.indexOf("def request_stop")),
  );
  assert(signalHandler.includes("stop_requested.set()"));
  assert(!signalHandler.includes("server.shutdown"));
});
