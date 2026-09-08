export class PublishedReleaseError extends Error {
  constructor(
    readonly code: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "PublishedReleaseError";
  }
}

export type PublishedReleaseExpected = {
  packageName: string;
  version: string;
  image: string;
  commit: string;
};

export type JsrPackageMeta = {
  versions?: Record<string, unknown>;
};

export type JsrFileMeta = {
  size?: number;
  checksum?: string;
};

export type JsrVersionMeta = {
  manifest?: Record<string, JsrFileMeta>;
};

export type JsrFileBytes = {
  sourceDenoJson: Uint8Array;
  sourceReadme: Uint8Array;
  publishedDenoJson: Uint8Array;
  publishedReadme: Uint8Array;
};

export type RegistryTagInspection = {
  tag: string;
  digest: string;
  labels: Record<string, string>;
};

export type PublishedReleaseVerification = {
  expected: PublishedReleaseExpected;
  jsrPackageMeta: JsrPackageMeta;
  jsrVersionMeta: JsrVersionMeta;
  jsrFiles: JsrFileBytes;
  versionTag: RegistryTagInspection;
  commitTag: RegistryTagInspection;
};

export type PublishedReleaseEvidence = {
  jsr: { package: string; version: string; specifier: string };
  ghcr: {
    image: string;
    versionTag: string;
    commitTag: string;
    digest: string;
    versionLabel: string;
    revisionLabel: string;
  };
};

export type OciIndex = {
  manifests?: Array<{
    digest?: string;
    platform?: { os?: string; architecture?: string };
    annotations?: Record<string, string>;
  }>;
};

const VERSION_LABEL = "org.opencontainers.image.version";
const REVISION_LABEL = "org.opencontainers.image.revision";
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
const JSR_CHECKSUM = /^sha256-[a-f0-9]{64}$/;

function fail(
  code: string,
  context: Record<string, unknown> = {},
): never {
  throw new PublishedReleaseError(code, context);
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const copy = Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
};

const requireOciDigest = (
  digest: string,
  context: Record<string, unknown> = {},
): string => {
  if (!OCI_DIGEST.test(digest)) {
    fail("GHCR_DIGEST_INVALID", { digest, ...context });
  }
  return digest;
};

const requireJsrChecksum = (
  checksum: string,
  context: Record<string, unknown> = {},
): string => {
  if (!JSR_CHECKSUM.test(checksum)) {
    fail("JSR_CHECKSUM_INVALID", { checksum, ...context });
  }
  return checksum;
};

const verifyBytesDigest = async (
  bytes: Uint8Array,
  expectedDigest: string,
  context: Record<string, unknown> = {},
): Promise<void> => {
  const expected = requireOciDigest(expectedDigest, context);
  const actual = `sha256:${await sha256Hex(bytes)}`;
  if (actual !== expected) {
    fail("GHCR_DIGEST_CORRUPT", { expected, actual, ...context });
  }
};

export const digestFromHeaders = (headers: Headers): string => {
  const digest = headers.get("Docker-Content-Digest")?.trim() ?? "";
  if (digest.length === 0) {
    fail("GHCR_DIGEST_MISSING", { digest });
  }
  return requireOciDigest(digest);
};

export const linuxAmd64ManifestDigest = (index: OciIndex): string => {
  const matches = (index.manifests ?? []).filter((manifest) =>
    manifest.platform?.os === "linux" &&
    manifest.platform?.architecture === "amd64" &&
    manifest.annotations?.["vnd.docker.reference.type"] !==
      "attestation-manifest"
  );
  if (matches.length === 0) {
    fail("GHCR_PLATFORM_MISSING", { digest: "" });
  }
  if (matches.length > 1) {
    fail("GHCR_PLATFORM_AMBIGUOUS", {
      digests: matches.map((manifest) => manifest.digest ?? ""),
    });
  }
  return requireOciDigest(matches[0]?.digest?.trim() ?? "");
};

const manifestChecksum = (
  versionMeta: JsrVersionMeta,
  path: string,
): string => {
  const checksum = versionMeta.manifest?.[path]?.checksum?.trim() ?? "";
  if (checksum.length === 0) {
    fail("JSR_FILE_MISSING", { path });
  }
  return requireJsrChecksum(checksum, { path });
};

const verifyJsrFile = async (
  path: string,
  sourceBytes: Uint8Array,
  publishedBytes: Uint8Array,
  metaChecksum: string,
): Promise<void> => {
  const publishedChecksum = `sha256-${await sha256Hex(publishedBytes)}`;
  const sourceChecksum = `sha256-${await sha256Hex(sourceBytes)}`;
  if (
    publishedChecksum !== metaChecksum || sourceChecksum !== publishedChecksum
  ) {
    fail("JSR_FILE_MISMATCH", {
      path,
      metaChecksum,
      publishedChecksum,
      sourceChecksum,
    });
  }
};

const publishedPackageIdentity = (
  bytes: Uint8Array,
): { name: unknown; version: unknown } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("JSR_PACKAGE_VERSION_MISMATCH", { path: "/deno.json" });
  }
  if (!isRecord(parsed)) {
    fail("JSR_PACKAGE_VERSION_MISMATCH", { path: "/deno.json" });
  }
  return { name: parsed.name, version: parsed.version };
};

export const verifyPublishedRelease = async (
  input: PublishedReleaseVerification,
): Promise<PublishedReleaseEvidence> => {
  const { expected } = input;
  const versionInfo = input.jsrPackageMeta.versions?.[expected.version];
  if (versionInfo === undefined) {
    fail("JSR_VERSION_UNRESOLVABLE", {
      package: expected.packageName,
      version: expected.version,
    });
  }
  if (
    typeof versionInfo === "object" &&
    versionInfo !== null &&
    "yanked" in versionInfo &&
    versionInfo.yanked === true
  ) {
    fail("JSR_VERSION_YANKED", {
      package: expected.packageName,
      version: expected.version,
    });
  }

  await verifyJsrFile(
    "/deno.json",
    input.jsrFiles.sourceDenoJson,
    input.jsrFiles.publishedDenoJson,
    manifestChecksum(input.jsrVersionMeta, "/deno.json"),
  );
  await verifyJsrFile(
    "/README.md",
    input.jsrFiles.sourceReadme,
    input.jsrFiles.publishedReadme,
    manifestChecksum(input.jsrVersionMeta, "/README.md"),
  );
  const publishedPackage = publishedPackageIdentity(
    input.jsrFiles.publishedDenoJson,
  );
  if (
    publishedPackage.name !== expected.packageName ||
    publishedPackage.version !== expected.version
  ) {
    fail("JSR_PACKAGE_VERSION_MISMATCH", {
      expectedName: expected.packageName,
      expectedVersion: expected.version,
      name: publishedPackage.name,
      version: publishedPackage.version,
    });
  }

  const commitTag = `sha-${expected.commit}`;
  if (
    input.versionTag.tag !== expected.version ||
    input.commitTag.tag !== commitTag
  ) {
    fail("GHCR_TAG_MISMATCH", {
      expectedVersionTag: expected.version,
      expectedCommitTag: commitTag,
      versionTag: input.versionTag.tag,
      commitTag: input.commitTag.tag,
    });
  }
  const versionDigest = requireOciDigest(input.versionTag.digest);
  const commitDigest = requireOciDigest(input.commitTag.digest);
  if (versionDigest !== commitDigest) {
    fail("GHCR_DIGEST_MISMATCH", {
      versionDigest,
      commitDigest,
    });
  }

  const labels = {
    ...input.versionTag.labels,
    ...input.commitTag.labels,
  };
  const versionLabel = input.versionTag.labels[VERSION_LABEL] ??
    input.commitTag.labels[VERSION_LABEL];
  const revisionLabel = input.versionTag.labels[REVISION_LABEL] ??
    input.commitTag.labels[REVISION_LABEL];
  if (!versionLabel || !revisionLabel) {
    fail("GHCR_LABEL_MISSING", { labels });
  }
  if (
    input.versionTag.labels[VERSION_LABEL] !== expected.version ||
    input.commitTag.labels[VERSION_LABEL] !== expected.version
  ) {
    fail("GHCR_LABEL_VERSION_MISMATCH", {
      expected: expected.version,
      versionTag: input.versionTag.labels[VERSION_LABEL],
      commitTag: input.commitTag.labels[VERSION_LABEL],
    });
  }
  if (
    input.versionTag.labels[REVISION_LABEL] !== expected.commit ||
    input.commitTag.labels[REVISION_LABEL] !== expected.commit
  ) {
    fail("GHCR_LABEL_REVISION_MISMATCH", {
      expected: expected.commit,
      versionTag: input.versionTag.labels[REVISION_LABEL],
      commitTag: input.commitTag.labels[REVISION_LABEL],
    });
  }

  return {
    jsr: {
      package: expected.packageName,
      version: expected.version,
      specifier: `jsr:${expected.packageName}@${expected.version}`,
    },
    ghcr: {
      image: expected.image,
      versionTag: expected.version,
      commitTag,
      digest: versionDigest,
      versionLabel,
      revisionLabel,
    },
  };
};

export const formatPublishedReleaseNotes = (
  evidence: PublishedReleaseEvidence,
): string =>
  [
    `## ${evidence.jsr.package.slice(1)} ${evidence.jsr.version}`,
    "",
    "Post-publication registry evidence. This record is not a rebuild of any historical release.",
    "",
    `- JSR: \`${evidence.jsr.specifier}\``,
    `- GHCR index: \`${evidence.ghcr.image}@${evidence.ghcr.digest}\``,
    `- Version tag: \`${evidence.ghcr.versionTag}\``,
    `- Commit tag: \`${evidence.ghcr.commitTag}\``,
    `- OCI version label: \`${evidence.ghcr.versionLabel}\``,
    `- OCI revision label: \`${evidence.ghcr.revisionLabel}\``,
    "",
  ].join("\n");

const requiredFlag = (args: string[], name: string): string => {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    fail("INVALID_ARGS", { flag: name });
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const jsonHeaders = {
  accept: "application/json",
};

const ociManifestHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
  ].join(", "),
});

const parseImage = (
  image: string,
): { registry: string; repository: string } => {
  const slash = image.indexOf("/");
  if (slash <= 0 || slash === image.length - 1) {
    fail("INVALID_ARGS", { image });
  }
  return {
    registry: image.slice(0, slash),
    repository: image.slice(slash + 1),
  };
};

const readJson = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    fail("REGISTRY_RESPONSE_INVALID", { url: response.url });
  }
  return body;
};

const parseJsonRecord = (
  bytes: Uint8Array,
  url: string,
): Record<string, unknown> => {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("REGISTRY_RESPONSE_INVALID", { url });
  }
  if (!isRecord(body)) {
    fail("REGISTRY_RESPONSE_INVALID", { url });
  }
  return body;
};

const sourcePath = (sourceRoot: string, name: string): string =>
  sourceRoot.endsWith("/") ? `${sourceRoot}${name}` : `${sourceRoot}/${name}`;

const readSourceFile = async (
  sourceRoot: string,
  name: string,
): Promise<Uint8Array> => {
  const path = sourcePath(sourceRoot, name);
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail("JSR_SOURCE_UNAVAILABLE", { path: name, sourceRoot });
    }
    throw error;
  }
};

const readResponseBytes = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer());

const fetchPublishedFile = async (
  fetchImpl: typeof fetch,
  url: string,
  path: string,
): Promise<Uint8Array> => {
  const response = await fetchImpl(url, { headers: jsonHeaders });
  if (!response.ok) {
    fail("JSR_FILE_MISSING", { path, status: response.status });
  }
  return await readResponseBytes(response);
};

const fetchJsr = async (
  packageName: string,
  version: string,
  fetchImpl: typeof fetch,
): Promise<{
  meta: JsrPackageMeta;
  versionMeta: JsrVersionMeta;
  publishedDenoJson: Uint8Array;
  publishedReadme: Uint8Array;
}> => {
  const packageUrl = `https://jsr.io/${packageName}/meta.json`;
  const versionUrl = `https://jsr.io/${packageName}/${version}_meta.json`;
  const [packageResponse, versionResponse] = await Promise.all([
    fetchImpl(packageUrl, { headers: jsonHeaders }),
    fetchImpl(versionUrl, { headers: jsonHeaders }),
  ]);
  if (!packageResponse.ok) {
    fail("JSR_PACKAGE_UNAVAILABLE", { status: packageResponse.status });
  }
  if (!versionResponse.ok) {
    fail("JSR_VERSION_UNRESOLVABLE", {
      package: packageName,
      version,
      status: versionResponse.status,
    });
  }
  const [publishedDenoJson, publishedReadme] = await Promise.all([
    fetchPublishedFile(
      fetchImpl,
      `https://jsr.io/${packageName}/${version}/deno.json`,
      "/deno.json",
    ),
    fetchPublishedFile(
      fetchImpl,
      `https://jsr.io/${packageName}/${version}/README.md`,
      "/README.md",
    ),
  ]);
  return {
    meta: await readJson(packageResponse) as JsrPackageMeta,
    versionMeta: await readJson(versionResponse) as JsrVersionMeta,
    publishedDenoJson,
    publishedReadme,
  };
};

// Public GHCR images use the anonymous registry /token exchange.
// A raw GITHUB_TOKEN is not a registry bearer.
const ghcrToken = async (
  registry: string,
  repository: string,
  fetchImpl: typeof fetch,
): Promise<string> => {
  const tokenUrl =
    `https://${registry}/token?service=${registry}&scope=repository:${repository}:pull`;
  const response = await fetchImpl(tokenUrl, { headers: jsonHeaders });
  if (!response.ok) {
    fail("GHCR_TOKEN_UNAVAILABLE", { status: response.status });
  }
  const body = await readJson(response);
  const token = typeof body.token === "string"
    ? body.token
    : typeof body.access_token === "string"
    ? body.access_token
    : "";
  if (token.length === 0) {
    fail("GHCR_TOKEN_UNAVAILABLE", { status: response.status });
  }
  return token;
};

const inspectTag = async (
  registry: string,
  repository: string,
  tag: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<RegistryTagInspection> => {
  const manifestUrl = `https://${registry}/v2/${repository}/manifests/${tag}`;
  const manifestResponse = await fetchImpl(manifestUrl, {
    headers: ociManifestHeaders(token),
  });
  if (!manifestResponse.ok) {
    fail("GHCR_MANIFEST_UNAVAILABLE", { tag, status: manifestResponse.status });
  }
  const indexBytes = await readResponseBytes(manifestResponse);
  const digest = digestFromHeaders(manifestResponse.headers);
  await verifyBytesDigest(indexBytes, digest, { tag });
  const index = parseJsonRecord(indexBytes, manifestUrl) as OciIndex;
  const imageDigest = linuxAmd64ManifestDigest(index);
  const imageUrl = `https://${registry}/v2/${repository}/manifests/${imageDigest}`;
  const imageResponse = await fetchImpl(imageUrl, {
    headers: ociManifestHeaders(token),
  });
  if (!imageResponse.ok) {
    fail("GHCR_MANIFEST_UNAVAILABLE", {
      digest: imageDigest,
      status: imageResponse.status,
    });
  }
  const imageBytes = await readResponseBytes(imageResponse);
  const imageHeaderDigest = digestFromHeaders(imageResponse.headers);
  if (imageHeaderDigest !== imageDigest) {
    fail("GHCR_DIGEST_CORRUPT", {
      expected: imageDigest,
      actual: imageHeaderDigest,
    });
  }
  await verifyBytesDigest(imageBytes, imageDigest, { digest: imageDigest });
  const imageManifest = parseJsonRecord(imageBytes, imageUrl);
  const config = isRecord(imageManifest.config) ? imageManifest.config : {};
  const configDigest = typeof config.digest === "string" ? config.digest : "";
  requireOciDigest(configDigest, { tag });
  const blobUrl = `https://${registry}/v2/${repository}/blobs/${configDigest}`;
  const blobResponse = await fetchImpl(blobUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!blobResponse.ok) {
    fail("GHCR_CONFIG_UNAVAILABLE", { tag, status: blobResponse.status });
  }
  const configBytes = await readResponseBytes(blobResponse);
  const configHeader = blobResponse.headers.get("Docker-Content-Digest")
    ?.trim();
  if (configHeader) {
    const headerDigest = requireOciDigest(configHeader, { tag });
    if (headerDigest !== configDigest) {
      fail("GHCR_DIGEST_CORRUPT", {
        expected: configDigest,
        actual: headerDigest,
      });
    }
  }
  await verifyBytesDigest(configBytes, configDigest, { tag });
  const imageConfig = parseJsonRecord(configBytes, blobUrl);
  if (imageConfig.os !== "linux" || imageConfig.architecture !== "amd64") {
    fail("GHCR_PLATFORM_MISMATCH", {
      os: imageConfig.os,
      architecture: imageConfig.architecture,
    });
  }
  const configBlock = isRecord(imageConfig.config) ? imageConfig.config : {};
  const rawLabels = isRecord(configBlock.Labels) ? configBlock.Labels : {};
  const labels = Object.fromEntries(
    Object.entries(rawLabels).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  );
  return { tag, digest, labels };
};

export const inspectPublishedRelease = async (
  expected: PublishedReleaseExpected,
  sourceRoot: string,
  fetchImpl: typeof fetch = fetch,
  requestTimeoutMs = 30_000,
): Promise<PublishedReleaseEvidence> => {
  // Bound both headers and body, including a server that stops streaming bytes.
  const boundedFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(input, {
            ...init,
            signal: controller.signal,
          });
          const body = await response.arrayBuffer();
          return new Response(body.byteLength ? body : null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new PublishedReleaseError("REGISTRY_TIMEOUT"));
          }, requestTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const { registry, repository } = parseImage(expected.image);
  const sourceDenoJson = await readSourceFile(sourceRoot, "deno.json");
  const sourceReadme = await readSourceFile(sourceRoot, "README.md");
  const jsr = await fetchJsr(expected.packageName, expected.version, boundedFetch);
  const token = await ghcrToken(registry, repository, boundedFetch);
  const [versionTag, commitTag] = await Promise.all([
    inspectTag(registry, repository, expected.version, token, boundedFetch),
    inspectTag(
      registry,
      repository,
      `sha-${expected.commit}`,
      token,
      boundedFetch,
    ),
  ]);
  return await verifyPublishedRelease({
    expected,
    jsrPackageMeta: jsr.meta,
    jsrVersionMeta: jsr.versionMeta,
    jsrFiles: {
      sourceDenoJson,
      sourceReadme,
      publishedDenoJson: jsr.publishedDenoJson,
      publishedReadme: jsr.publishedReadme,
    },
    versionTag,
    commitTag,
  });
};

const runCli = async (args: string[]): Promise<void> => {
  const expected: PublishedReleaseExpected = {
    packageName: requiredFlag(args, "--package"),
    version: requiredFlag(args, "--version"),
    image: requiredFlag(args, "--image"),
    commit: requiredFlag(args, "--commit"),
  };
  const sourceRoot = requiredFlag(args, "--source-root");
  const evidenceFile = requiredFlag(args, "--evidence-file");
  const notesFile = requiredFlag(args, "--notes-file");
  const evidence = await inspectPublishedRelease(expected, sourceRoot);
  const notes = formatPublishedReleaseNotes(evidence);
  await Deno.writeTextFile(
    evidenceFile,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await Deno.writeTextFile(notesFile, notes);
  console.log(JSON.stringify(evidence));
};

if (import.meta.main) {
  try {
    await runCli(Deno.args);
  } catch (error) {
    const payload = error instanceof PublishedReleaseError
      ? { code: error.code, context: error.context }
      : {
        code: "PUBLISHED_RELEASE_VERIFY_FAILED",
        context: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    console.error(JSON.stringify(payload));
    Deno.exit(1);
  }
}
