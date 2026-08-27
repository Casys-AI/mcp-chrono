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
      "/opt/conda/conda-meta/pychrono-10.0.0-py312h3a49c4c_0.json",
    ),
  );
  assert(
    dockerfile.includes(
      "/opt/conda/conda-meta/chrono-10.0.0-py312h14c7f5c_0.json",
    ),
  );
  assert(!dockerfile.includes("CHRONO_VERSION"));
  assert(dockerfile.includes('pychrono_metadata["name"] == "pychrono"'));
  assert(dockerfile.includes('pychrono_metadata["version"] == "10.0.0"'));
  assert(
    dockerfile.includes('pychrono_metadata["build"] == "py312h3a49c4c_0"'),
  );
  assert(dockerfile.includes('chrono_metadata["name"] == "chrono"'));
  assert(dockerfile.includes('chrono_metadata["version"] == "10.0.0"'));
  assert(dockerfile.includes('chrono_metadata["build"] == "py312h14c7f5c_0"'));
  assert(dockerfile.includes("test -d /opt/conda/share/chrono/data"));
  assert(
    dockerfile.includes(
      "test -d /opt/conda/lib/python3.12/site-packages/pychrono/demos",
    ),
  );
  assert(
    dockerfile.indexOf("rm -rf /opt/conda/share/chrono/data") <
      dockerfile.indexOf("import pychrono.core as chrono"),
  );
  assert(dockerfile.includes('"ChSystemNSC"'));
  assert(dockerfile.includes('"GetMotorAngle"'));
  assert(dockerfile.includes("/opt/conda/share/chrono/data"));
  assert(
    dockerfile.includes(
      "/opt/conda/lib/python3.12/site-packages/pychrono/demos",
    ),
  );
  assert(dockerfile.includes('Path("/opt/conda").rglob("__pycache__")'));
  const lock = await text("locks/pychrono-linux-64.explicit.txt");
  assert(lock.includes("@EXPLICIT"));
  assert(
    lock.includes(
      "mambaorg/micromamba@sha256:2681c45bf145f9b292fc26120646125586a2be4289eda48ce8a94ae2b22eda67",
    ),
  );
  assert(
    lock.includes(
      "micromamba create --dry-run --json --strict-channel-priority --name chrono-cpu --channel conda-forge python=3.12 pychrono=10.0.0",
    ),
  );
  assertEquals((lock.match(/^# sha256=/gm) ?? []).length, 31);
  assert(
    lock.includes(
      "chrono-10.0.0-py312h14c7f5c_0.conda#56d1c396c2cc46500685025496e6b04825b521ebea1f3a3bbf391dcf0d22bc7a",
    ),
  );
  assert(
    lock.includes(
      "pychrono-10.0.0-py312h3a49c4c_0.conda#c8b8d1d237c4e1f41cca0b37340351473d6652085546fa6ab365dce328f87b1c",
    ),
  );
  for (
    const forbiddenPackagePrefix of [
      "cuda",
      "cudnn",
      "libcu",
      "mkl",
      "intel-mkl",
      "mpi",
      "openmpi",
      "mpich",
      "libgl",
      "libegl",
      "libopengl",
      "opengl",
      "xorg-",
      "font-",
      "fonts-",
      "qt",
      "vtk",
      "irrlicht",
    ]
  ) {
    assert(
      !lock.includes(`package=${forbiddenPackagePrefix}`),
      `CPU-only lock includes ${forbiddenPackagePrefix}`,
    );
  }
  assertEquals(deno.version, "0.1.0");
  const types = await text("src/domain/types.ts");
  assert(types.includes('CHRONO_VERSION = "10.0.0"'));
  assert(types.includes(`PROVIDER_VERSION = "${deno.version}"`));
  assert((await text("src/server.ts")).includes("version: PROVIDER_VERSION"));
});
Deno.test("release workflow requires explicit artifact clearance and does not publish latest", async () => {
  const ci = await text(".github/workflows/ci.yml");
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
  for (const workflow of [ci, release]) {
    assert(workflow.includes("Verify CPU-only lock boundary"));
    assert(workflow.includes("docker image inspect"));
    assert(workflow.includes("docker image save"));
    assert(workflow.includes("docker history --no-trunc"));
    assert(
      workflow.includes(
        "anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610",
      ),
    );
    assert(workflow.includes("format: spdx-json"));
    assert(workflow.includes("upload-artifact: true"));
    assert(workflow.includes("upload-release-assets: false"));
  }
  assert(ci.includes("image: mcp-chrono:ci"));
  assert(release.includes("image: mcp-chrono:release-verify"));
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
