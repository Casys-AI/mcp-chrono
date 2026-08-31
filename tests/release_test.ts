import { assert, assertEquals } from "@std/assert";

const root = new URL("..", import.meta.url).pathname;
async function text(path: string) {
  return await Deno.readTextFile(`${root}/${path}`);
}
Deno.test("release pins and package version stay explicit", async () => {
  const dockerfile = await text("Dockerfile");
  const deno = JSON.parse(await text("deno.json"));
  const citation = await text("CITATION.cff");
  assert(
    dockerfile.includes(
      "mambaorg/micromamba@sha256:2681c45bf145f9b292fc26120646125586a2be4289eda48ce8a94ae2b22eda67",
    ),
  );
  assert(
    dockerfile.includes(
      "denoland/deno:bin-2.9.6@sha256:456e1a0fada18d727c3f38eb4937218c1b46924c832b713dcf9358eb32ff15a6",
    ),
  );
  assert(
    dockerfile.includes(
      "deno eval 'console.log(Deno.version.deno)'",
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
  assert(
    dockerfile.includes(
      "COPY LICENSES /usr/share/licenses/mcp-chrono",
    ),
  );
  assert(dockerfile.includes("/app/scripts/collect_conda_notices.py"));
  assert(dockerfile.includes("/app/scripts/verify_image_notices.py"));
  assert(dockerfile.includes("rm -rf /opt/conda/pkgs"));
  assert(dockerfile.includes("! test -e /opt/conda/pkgs"));
  assert(
    dockerfile.indexOf("rm -rf /opt/conda/pkgs") <
      dockerfile.indexOf("import pychrono.core as chrono"),
  );
  assert(!dockerfile.includes("micromamba clean --all --yes"));
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
  assertEquals(deno.version, "0.3.2");
  assertEquals(deno.exports, {
    ".": "./mod.ts",
    "./server": "./server.ts",
  });
  assert(citation.includes(`version: "${deno.version}"`));
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
  const changelog = await text("CHANGELOG.md");
  const security = await text("SECURITY.md");
  const compose = await text("deploy/compose.yaml");
  const envExample = await text("deploy/.env.example");
  const sourceVersion = JSON.parse(await text("deno.json")).version as string;
  const previousVersion = "0.3.1";
  const previousPublicImage =
    "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c";
  const publicReleaseImage =
    "ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557";
  const releaseCommit = "18e118453111391eae632f8f5ec737e6c9f04847";
  const releaseImage = `ghcr.io/casys-ai/mcp-chrono:${sourceVersion}`;
  const jsrServer = `jsr:@casys/mcp-chrono@${sourceVersion}/server --stdio`;
  const composeFallbackImage =
    "ghcr.io/casys-ai/mcp-chrono@sha256:b9332fdf44634a565596d5cee6e64c9735b35d22299fab806631eaf86aa479a6";
  const knownReleaseDigests = new Set([
    "2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557",
    "b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
    "373be7bae6fed0518bcea6f8da29ae79259148083fbd3048170fbf52904fb795",
    "39eb29a2ba2de72d2af1fefe0897650674d9bb519f866ec2874472facf71ea5c",
    "b9332fdf44634a565596d5cee6e64c9735b35d22299fab806631eaf86aa479a6",
    "98a47f6a2aef49f429059692b1d4ee34feb361581768a1bd954d441ed7c450da",
    "254927f8581e35f8fcc4e83f1fa92ec218e3c0d21e54dc0436651704bae6b7d6",
    "3bc07b0bf3bf40e0412141f5ffe1bfb4ae93d98dfeed09384211cf620640b381",
    "fb3af9519ff60c1911221c2a3286a112eb7aeae6cd9c089f042d9a9275d62d3d",
  ]);
  assertEquals(sourceVersion, "0.3.2");
  assert(sourceVersion !== previousVersion);
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
    assert(
      workflow.includes('SYFT_SELECT_CATALOGERS: "+conda-meta-cataloger"'),
    );
    assert(workflow.includes("upload-artifact: true"));
    assert(workflow.includes("upload-release-assets: false"));
    assert(workflow.includes('.name == "chrono"'));
    assert(workflow.includes('.name == "pychrono"'));
    assert(workflow.includes("Verify final image notice boundary"));
    assert(workflow.includes("/app/scripts/verify_image_notices.py"));
  }
  assert(ci.includes("image: mcp-chrono:ci"));
  assert(release.includes("image: mcp-chrono:release-verify"));
  const jsrStart = release.indexOf("  publish-jsr:");
  const ghcrStart = release.indexOf("  publish-ghcr:");
  assert(jsrStart > 0);
  assert(ghcrStart > jsrStart);
  const jsrJob = release.slice(jsrStart, ghcrStart);
  const ghcrJob = release.slice(ghcrStart);
  assert(
    jsrJob.includes("if: vars.CHRONO_JSR_RELEASE_ENABLED == 'true'"),
  );
  assert(jsrJob.includes("deno publish"));
  assert(!jsrJob.includes("docker/login-action"));
  assert(
    ghcrJob.includes("if: vars.CHRONO_GHCR_RELEASE_ENABLED == 'true'"),
  );
  assert(!ghcrJob.includes("deno publish"));
  assert(ghcrJob.includes("docker/login-action"));
  assert(
    ghcrJob.includes(
      "docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e",
    ),
  );
  assert(ghcrJob.includes("push: true"));
  assert(release.includes("REGISTRY_IMAGE: ghcr.io/casys-ai/mcp-chrono"));
  assert(
    ghcrJob.includes("${{ env.REGISTRY_IMAGE }}:${{ needs.verify.outputs.version }}"),
  );
  assert(!ghcrJob.includes("ghcr.io/${{ github.repository }}"));
  assert(ghcrJob.includes("Refuse to overwrite immutable GHCR tags"));
  assert(!release.includes("CHRONO_RELEASE_ENABLED"));
  assert(!release.includes("--allow-slow-types"));
  assert(!deno.includes("--allow-slow-types"));
  assert(deno.includes("container_entrypoint_test.py"));
  assert(deno.includes("chrono_worker_test.py"));
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
  assert(!manifest.includes("release_status"));
  assert(readme.includes("CHRONO_GHCR_RELEASE_ENABLED"));
  assert(readme.includes("CHRONO_JSR_RELEASE_ENABLED"));
  assert(readme.replaceAll(/\s+/g, " ").includes("explicitly authorized"));
  assert(readme.includes(`**${sourceVersion}**`));
  assert(readme.includes(releaseImage));
  assert(readme.includes(jsrServer));
  assert(readme.includes(publicReleaseImage));
  assert(readme.includes(`sha-${releaseCommit}`));
  assert(readme.includes(previousPublicImage));
  const collapsedReadme = readme.replaceAll(/\s+/g, " ");
  assert(
    collapsedReadme.includes(
      `OCI revision \`${releaseCommit}\``,
    ),
  );
  assert(collapsedReadme.includes("both resolve to OCI index"));
  assert(collapsedReadme.includes("fresh-imported successfully"));
  assert(
    collapsedReadme.includes(
      "the source version alone is not a registry fact.",
    ),
  );
  assert(readme.includes("never publishes `latest`"));
  assert(!readme.includes(":latest"));
  assert(!changelog.includes(":latest"));
  assert(!security.includes(":latest"));
  const releaseEntry = changelog.split("## 0.3.2")[1]?.split("## 0.3.1")[0] ?? "";
  assert(changelog.includes(`## ${sourceVersion} — 2026-08-31`));
  assert(releaseEntry.includes("terminal-tick"));
  assert(releaseEntry.includes(`Published JSR \`@casys/mcp-chrono@${sourceVersion}\``));
  assert(
    releaseEntry.includes(
      publicReleaseImage.replace("ghcr.io/casys-ai/mcp-chrono@", ""),
    ),
  );
  assert(releaseEntry.includes(releaseCommit));
  assert(!/has not happened/i.test(releaseEntry));
  assert(!/source candidate/i.test(releaseEntry));
  for (
    const phrase of [
      "source candidate",
      "candidate only",
      "has not happened",
      "does not exist yet",
      "not published yet",
      "currently published",
    ]
  ) {
    assert(
      !collapsedReadme.toLowerCase().includes(phrase),
      `README still claims ${phrase}`,
    );
    assert(
      !security.toLowerCase().includes(phrase),
      `SECURITY still claims ${phrase}`,
    );
  }
  for (
    const [name, doc] of [
      ["README", readme],
      ["CHANGELOG", changelog],
      ["SECURITY", security],
    ] as const
  ) {
    for (const match of doc.matchAll(/sha256:([0-9a-f]{64})/g)) {
      assert(
        knownReleaseDigests.has(match[1]),
        `${name} invents digest ${match[1]}`,
      );
    }
  }
  assert(security.includes(sourceVersion));
  assert(security.includes(previousVersion));
  assert(
    security.includes(publicReleaseImage.replace("ghcr.io/casys-ai/mcp-chrono@", "")),
  );
  assert(
    security.includes(
      "sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c",
    ),
  );
  assert(!security.includes(releaseImage));
  assert(!/currently published/i.test(security));
  assert(readme.includes("chrono_case_template_get"));
  assert(readme.includes("sample_offset"));
  assert(compose.includes(composeFallbackImage));
  assert(envExample.includes(composeFallbackImage));
  assert(!readme.includes("GHCR publication is still pending"));
  assert(dockerSmoke.includes("native-smoke-zero-angle-reference"));
  assert(dockerSmoke.includes('"chrono_case_get"'));
  assert(dockerSmoke.includes('"chrono_run_receipt_get"'));
  assert(dockerSmoke.includes('["record"]["observation"]'));
  assert(dockerSmoke.includes('["record"]["receipt"]'));
  assert(dockerSmoke.includes('["record"]["sample_page"]'));
  assert(!dockerSmoke.includes('["record"]["output"]'));
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
