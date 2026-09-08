import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  digestFromHeaders,
  formatPublishedReleaseNotes,
  inspectPublishedRelease,
  linuxAmd64ManifestDigest,
  PublishedReleaseError,
  verifyPublishedRelease,
} from "../scripts/verify_published_release.ts";

const fail = (fn: () => unknown) =>
  assertThrows(fn, PublishedReleaseError) as PublishedReleaseError;

const failAsync = async (fn: () => Promise<unknown>) =>
  await assertRejects(fn, PublishedReleaseError) as PublishedReleaseError;

const expected = {
  packageName: "@casys/mcp-chrono",
  version: "0.3.4",
  image: "ghcr.io/casys-ai/mcp-chrono",
  commit: "f40659ab8bdb29c7e474ee4bd43720cbe1a2f7d6",
};
const digest =
  "sha256:3b6bff8661e7b985630c64b22f219f5bc4d5a21a0fcf3632b8c07a7ba5a5e2e3";
const matchingLabels = {
  "org.opencontainers.image.version": expected.version,
  "org.opencontainers.image.revision": expected.commit,
};

const jsrPackageMeta = {
  versions: { [expected.version]: { createdAt: "2026-09-05T03:49:42.734583Z" } },
};

const tag = (
  name: string,
  tagDigest = digest,
  labels: Record<string, string> = matchingLabels,
) => ({ tag: name, digest: tagDigest, labels });

const bytesOf = (text: string) => new TextEncoder().encode(text);

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digestBytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
};

const jsrChecksum = async (bytes: Uint8Array) => `sha256-${await sha256Hex(bytes)}`;

const packagedDenoJson = (version = expected.version) =>
  JSON.stringify({
    name: expected.packageName,
    version,
  });
const packagedReadme = "# mcp-chrono\n";

const validInput = async () => {
  const sourceDenoJson = bytesOf(packagedDenoJson());
  const sourceReadme = bytesOf(packagedReadme);
  return {
    expected,
    jsrPackageMeta,
    jsrVersionMeta: {
      manifest: {
        "/deno.json": { checksum: await jsrChecksum(sourceDenoJson) },
        "/README.md": { checksum: await jsrChecksum(sourceReadme) },
      },
    },
    jsrFiles: {
      sourceDenoJson,
      sourceReadme,
      publishedDenoJson: sourceDenoJson,
      publishedReadme: sourceReadme,
    },
    versionTag: tag(expected.version),
    commitTag: tag(`sha-${expected.commit}`),
  };
};

const TOKEN = "registry-token";
const tokenUrl =
  "https://ghcr.io/token?service=ghcr.io&scope=repository:casys-ai/mcp-chrono:pull";
const versionManifestUrl = "https://ghcr.io/v2/casys-ai/mcp-chrono/manifests/0.3.4";
const commitManifestUrl =
  `https://ghcr.io/v2/casys-ai/mcp-chrono/manifests/sha-${expected.commit}`;
const jsrPackageUrl = "https://jsr.io/@casys/mcp-chrono/meta.json";
const jsrVersionUrl = "https://jsr.io/@casys/mcp-chrono/0.3.4_meta.json";
const jsrDenoJsonUrl = "https://jsr.io/@casys/mcp-chrono/0.3.4/deno.json";
const jsrReadmeUrl = "https://jsr.io/@casys/mcp-chrono/0.3.4/README.md";

type Route = {
  status?: number;
  headers?: Record<string, string>;
  body?: BodyInit;
};

const fetchFrom = (routes: Record<string, Route>): typeof fetch =>
  ((input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("Authorization") ?? "";
    if (url.startsWith("https://ghcr.io/token")) {
      if (authorization.length > 0) {
        return Promise.resolve(
          new Response("anonymous token exchange required", { status: 401 }),
        );
      }
    } else if (url.startsWith("https://ghcr.io/v2/")) {
      if (authorization !== `Bearer ${TOKEN}`) {
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }
    }
    const route = routes[url];
    if (route === undefined) {
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }
    return Promise.resolve(
      new Response(route.body ?? "", {
        status: route.status ?? 200,
        headers: route.headers,
      }),
    );
  }) as typeof fetch;

const makeGhcr = async (
  labels: Record<string, string> = matchingLabels,
  architecture = "amd64",
) => {
  const configBytes = bytesOf(
    JSON.stringify({ os: "linux", architecture, config: { Labels: labels } }),
  );
  const configDigest = `sha256:${await sha256Hex(configBytes)}`;
  const imageBytes = bytesOf(JSON.stringify({
    schemaVersion: 2,
    config: { digest: configDigest, size: configBytes.length },
  }));
  const imageDigest = `sha256:${await sha256Hex(imageBytes)}`;
  const indexBytes = bytesOf(JSON.stringify({
    schemaVersion: 2,
    manifests: [
      {
        digest: imageDigest,
        platform: { os: "linux", architecture: "amd64" },
      },
      {
        digest:
          "sha256:2bd142c02527c702c5a17104fd37ddd6592f8cba7b1ecd7f4cebf9948fbc1009",
        platform: { os: "unknown", architecture: "unknown" },
        annotations: { "vnd.docker.reference.type": "attestation-manifest" },
      },
    ],
  }));
  const indexDigest = `sha256:${await sha256Hex(indexBytes)}`;
  return {
    configBytes,
    configDigest,
    imageBytes,
    imageDigest,
    indexBytes,
    indexDigest,
    imageManifestUrl: `https://ghcr.io/v2/casys-ai/mcp-chrono/manifests/${imageDigest}`,
    configBlobUrl: `https://ghcr.io/v2/casys-ai/mcp-chrono/blobs/${configDigest}`,
  };
};

const publishedRoutes = async (opts?: {
  architecture?: string;
  denoJsonText?: string;
  readmeText?: string;
  publishedDenoJsonText?: string;
  publishedReadmeText?: string;
  routes?: Record<string, Route>;
}) => {
  const denoJsonText = opts?.denoJsonText ?? packagedDenoJson();
  const readmeText = opts?.readmeText ?? packagedReadme;
  const publishedDenoJsonText = opts?.publishedDenoJsonText ?? denoJsonText;
  const publishedReadmeText = opts?.publishedReadmeText ?? readmeText;
  const publishedDenoJson = bytesOf(publishedDenoJsonText);
  const publishedReadme = bytesOf(publishedReadmeText);
  const ghcr = await makeGhcr(matchingLabels, opts?.architecture);
  const digestHeaders = { "Docker-Content-Digest": ghcr.indexDigest };
  const routes: Record<string, Route> = {
    [jsrPackageUrl]: { body: JSON.stringify(jsrPackageMeta) },
    [jsrVersionUrl]: {
      body: JSON.stringify({
        manifest: {
          "/deno.json": { checksum: await jsrChecksum(publishedDenoJson) },
          "/README.md": { checksum: await jsrChecksum(publishedReadme) },
        },
      }),
    },
    [jsrDenoJsonUrl]: { body: publishedDenoJson },
    [jsrReadmeUrl]: { body: publishedReadme },
    [tokenUrl]: { body: JSON.stringify({ token: TOKEN }) },
    [versionManifestUrl]: { body: ghcr.indexBytes, headers: digestHeaders },
    [commitManifestUrl]: { body: ghcr.indexBytes, headers: digestHeaders },
    [ghcr.imageManifestUrl]: {
      body: ghcr.imageBytes,
      headers: { "Docker-Content-Digest": ghcr.imageDigest },
    },
    [ghcr.configBlobUrl]: {
      body: ghcr.configBytes,
      headers: { "Docker-Content-Digest": ghcr.configDigest },
    },
    ...opts?.routes,
  };
  return { denoJsonText, readmeText, ghcr, routes };
};

const withSourceRoot = async (
  files: { denoJson: string; readme: string },
  fn: (sourceRoot: string) => Promise<void>,
) => {
  const sourceRoot = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${sourceRoot}/deno.json`, files.denoJson);
    await Deno.writeTextFile(`${sourceRoot}/README.md`, files.readme);
    await fn(sourceRoot);
  } finally {
    await Deno.remove(sourceRoot, { recursive: true });
  }
};

Deno.test("published release helper accepts exact JSR version and matching GHCR tags", async () => {
  const evidence = await verifyPublishedRelease(await validInput());
  assertEquals(evidence, {
    jsr: {
      package: expected.packageName,
      version: expected.version,
      specifier: "jsr:@casys/mcp-chrono@0.3.4",
    },
    ghcr: {
      image: expected.image,
      versionTag: expected.version,
      commitTag: `sha-${expected.commit}`,
      digest,
      versionLabel: expected.version,
      revisionLabel: expected.commit,
    },
  });
});

Deno.test("published release helper rejects a missing exact JSR version", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      jsrPackageMeta: { versions: { "0.3.3": {} } },
    })
  );
  assertEquals(error.code, "JSR_VERSION_UNRESOLVABLE");
  assertEquals(error.context.version, expected.version);
});

Deno.test("published release helper rejects a yanked exact JSR version", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      jsrPackageMeta: { versions: { [expected.version]: { yanked: true } } },
    })
  );
  assertEquals(error.code, "JSR_VERSION_YANKED");
});

Deno.test("published release helper rejects JSR version metadata without packaged files", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      jsrVersionMeta: { manifest: {} },
    })
  );
  assertEquals(error.code, "JSR_FILE_MISSING");
});

Deno.test("published release helper rejects GHCR version and commit tags with different digests", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      commitTag: tag(
        `sha-${expected.commit}`,
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ),
    })
  );
  assertEquals(error.code, "GHCR_DIGEST_MISMATCH");
  assertEquals(error.context.versionDigest, digest);
});

Deno.test("published release helper rejects a GHCR digest that is not sha256 hex", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      versionTag: tag(expected.version, "sha256:not-a-digest"),
      commitTag: tag(`sha-${expected.commit}`, "sha256:not-a-digest"),
    })
  );
  assertEquals(error.code, "GHCR_DIGEST_INVALID");
});

Deno.test("published release helper rejects GHCR tags that do not name the release version and commit", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      versionTag: tag("latest"),
    })
  );
  assertEquals(error.code, "GHCR_TAG_MISMATCH");
});

Deno.test("published release helper rejects OCI version and revision label mismatches", async () => {
  const input = await validInput();
  const versionError = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      versionTag: tag(expected.version, digest, {
        "org.opencontainers.image.version": "0.3.3",
        "org.opencontainers.image.revision": expected.commit,
      }),
      commitTag: tag(`sha-${expected.commit}`, digest, {
        "org.opencontainers.image.version": "0.3.3",
        "org.opencontainers.image.revision": expected.commit,
      }),
    })
  );
  assertEquals(versionError.code, "GHCR_LABEL_VERSION_MISMATCH");

  const revisionError = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      versionTag: tag(expected.version, digest, {
        "org.opencontainers.image.version": expected.version,
        "org.opencontainers.image.revision": "deadbeef",
      }),
      commitTag: tag(`sha-${expected.commit}`, digest, {
        "org.opencontainers.image.version": expected.version,
        "org.opencontainers.image.revision": "deadbeef",
      }),
    })
  );
  assertEquals(revisionError.code, "GHCR_LABEL_REVISION_MISMATCH");
});

Deno.test("published release helper rejects missing OCI version or revision labels", async () => {
  const input = await validInput();
  const error = await failAsync(() =>
    verifyPublishedRelease({
      ...input,
      versionTag: tag(expected.version, digest, {}),
      commitTag: tag(`sha-${expected.commit}`, digest, {}),
    })
  );
  assertEquals(error.code, "GHCR_LABEL_MISSING");
});

Deno.test("GHCR helpers read the registry digest and linux/amd64 image, not attestations", () => {
  assertEquals(
    digestFromHeaders(
      new Headers({ "Docker-Content-Digest": digest }),
    ),
    digest,
  );
  const missing = fail(() => digestFromHeaders(new Headers()));
  assertEquals(missing.code, "GHCR_DIGEST_MISSING");
  const invalid = fail(() =>
    digestFromHeaders(
      new Headers({ "Docker-Content-Digest": "sha256:ABCD" }),
    )
  );
  assertEquals(invalid.code, "GHCR_DIGEST_INVALID");
  assertEquals(
    linuxAmd64ManifestDigest({
      manifests: [
        {
          digest:
            "sha256:30a51ae5473da9b9572f0338099e34057ae5bd7d092d258fc669a928e0bae369",
          platform: { os: "linux", architecture: "amd64" },
        },
        {
          digest:
            "sha256:2bd142c02527c702c5a17104fd37ddd6592f8cba7b1ecd7f4cebf9948fbc1009",
          platform: { os: "unknown", architecture: "unknown" },
          annotations: { "vnd.docker.reference.type": "attestation-manifest" },
        },
      ],
    }),
    "sha256:30a51ae5473da9b9572f0338099e34057ae5bd7d092d258fc669a928e0bae369",
  );
  const missingPlatform = fail(() => linuxAmd64ManifestDigest({ manifests: [] }));
  assertEquals(missingPlatform.code, "GHCR_PLATFORM_MISSING");
  const ambiguous = fail(() =>
    linuxAmd64ManifestDigest({
      manifests: [
        {
          digest:
            "sha256:30a51ae5473da9b9572f0338099e34057ae5bd7d092d258fc669a928e0bae369",
          platform: { os: "linux", architecture: "amd64" },
        },
        {
          digest:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          platform: { os: "linux", architecture: "amd64" },
        },
      ],
    })
  );
  assertEquals(ambiguous.code, "GHCR_PLATFORM_AMBIGUOUS");
});

Deno.test("published release notes record the registry-fetched digest and do not claim a rebuild", async () => {
  const notes = formatPublishedReleaseNotes(
    await verifyPublishedRelease(await validInput()),
  );
  assertEquals(
    notes.includes(`ghcr.io/casys-ai/mcp-chrono@${digest}`),
    true,
  );
  assertEquals(notes.includes("jsr:@casys/mcp-chrono@0.3.4"), true);
  assertEquals(notes.includes("sha-f40659ab8bdb29c7e474ee4bd43720cbe1a2f7d6"), true);
  assertEquals(
    notes.includes("not a rebuild of any historical release"),
    true,
  );
  assertEquals(notes.includes("Post-publication registry evidence"), true);
});

Deno.test("inspectPublishedRelease uses anonymous GHCR token exchange and ignores GITHUB_TOKEN", async () => {
  const published = await publishedRoutes();
  const previousToken = Deno.env.get("GITHUB_TOKEN");
  Deno.env.set("GITHUB_TOKEN", "ghs_not_a_registry_bearer");
  try {
    await withSourceRoot(
      { denoJson: published.denoJsonText, readme: published.readmeText },
      async (sourceRoot) => {
        const evidence = await inspectPublishedRelease(
          expected,
          sourceRoot,
          fetchFrom(published.routes),
        );
        assertEquals(evidence.jsr.specifier, "jsr:@casys/mcp-chrono@0.3.4");
        assertEquals(evidence.ghcr.digest, published.ghcr.indexDigest);
        assertEquals(evidence.ghcr.versionLabel, expected.version);
        assertEquals(evidence.ghcr.revisionLabel, expected.commit);
      },
    );
  } finally {
    if (previousToken === undefined) Deno.env.delete("GITHUB_TOKEN");
    else Deno.env.set("GITHUB_TOKEN", previousToken);
  }
});

Deno.test("inspectPublishedRelease rejects a failed anonymous token exchange", async () => {
  const published = await publishedRoutes({
    routes: { [tokenUrl]: { status: 401, body: "{}" } },
  });
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_TOKEN_UNAVAILABLE");
    },
  );
});

Deno.test("inspectPublishedRelease rejects index bytes that do not match Docker-Content-Digest", async () => {
  const published = await publishedRoutes({
    routes: {
      [versionManifestUrl]: {
        body: bytesOf('{"schemaVersion":2,"manifests":[]}'),
        headers: {
          "Docker-Content-Digest":
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    },
  });
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_DIGEST_CORRUPT");
    },
  );
});

Deno.test("inspectPublishedRelease rejects child manifest bytes that do not match the referenced digest", async () => {
  const published = await publishedRoutes();
  published.routes[published.ghcr.imageManifestUrl] = {
    body: bytesOf(
      `{"schemaVersion":2,"config":{"digest":"sha256:${"c".repeat(64)}"}}`,
    ),
    headers: { "Docker-Content-Digest": published.ghcr.imageDigest },
  };
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_DIGEST_CORRUPT");
    },
  );
});

Deno.test("inspectPublishedRelease rejects a missing config blob", async () => {
  const published = await publishedRoutes();
  published.routes[published.ghcr.configBlobUrl] = { status: 404, body: "" };
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_CONFIG_UNAVAILABLE");
    },
  );
});

Deno.test("inspectPublishedRelease rejects config bytes that do not match the referenced digest", async () => {
  const published = await publishedRoutes();
  published.routes[published.ghcr.configBlobUrl] = {
    body: bytesOf('{"config":{"Labels":{}}}'),
    headers: { "Docker-Content-Digest": published.ghcr.configDigest },
  };
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_DIGEST_CORRUPT");
    },
  );
});

Deno.test("inspectPublishedRelease rejects a missing GHCR commit tag", async () => {
  const published = await publishedRoutes({
    routes: { [commitManifestUrl]: { status: 404, body: "" } },
  });
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "GHCR_MANIFEST_UNAVAILABLE");
    },
  );
});

Deno.test("inspectPublishedRelease rejects a published README that does not match the tagged checkout", async () => {
  const published = await publishedRoutes({
    readmeText: "# tagged checkout\n",
    publishedReadmeText: "# published elsewhere\n",
  });
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "JSR_FILE_MISMATCH");
      assertEquals(error.context.path, "/README.md");
    },
  );
});

Deno.test("inspectPublishedRelease rejects a published deno.json whose version is not the release", async () => {
  const published = await publishedRoutes({
    denoJsonText: packagedDenoJson("0.9.9"),
    publishedDenoJsonText: packagedDenoJson("0.9.9"),
  });
  await withSourceRoot(
    { denoJson: published.denoJsonText, readme: published.readmeText },
    async (sourceRoot) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, sourceRoot, fetchFrom(published.routes))
      );
      assertEquals(error.code, "JSR_PACKAGE_VERSION_MISMATCH");
      assertEquals(error.context.version, "0.9.9");
    },
  );
});

Deno.test("inspectPublishedRelease rejects actual config platform differing from index", async () => {
  const fixture = await publishedRoutes({ architecture: "arm64" });
  await withSourceRoot(
    { denoJson: fixture.denoJsonText, readme: fixture.readmeText },
    async (root) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, root, fetchFrom(fixture.routes))
      );
      assertEquals(error.code, "GHCR_PLATFORM_MISMATCH");
    },
  );
});

Deno.test("inspectPublishedRelease bounds a stalled response body", async () => {
  const fixture = await publishedRoutes();
  const regularFetch = fetchFrom(fixture.routes);
  const stalledFetch: typeof fetch = (input, init) => {
    if (String(input) !== tokenUrl) return regularFetch(input, init);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener(
          "abort",
          () => controller.error(new Error("aborted")),
          { once: true },
        );
      },
    });
    return Promise.resolve(new Response(body));
  };
  await withSourceRoot(
    { denoJson: fixture.denoJsonText, readme: fixture.readmeText },
    async (root) => {
      const error = await failAsync(() =>
        inspectPublishedRelease(expected, root, stalledFetch, 20)
      );
      assertEquals(error.code, "REGISTRY_TIMEOUT");
    },
  );
});
