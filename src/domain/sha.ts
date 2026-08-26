import { ChronoError } from "./errors.ts";

const HEX = /^[a-f0-9]{64}$/;
export function requireSha256(value: unknown): string {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new ChronoError(
      "invalid_sha256",
      "SHA-256 must be 64 lowercase hexadecimal characters.",
    );
  }
  return value;
}
export async function sha256Utf8(text: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(text));
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Copy into a non-shared ArrayBuffer accepted by the WebCrypto declaration.
  const copy = Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join(
    "",
  );
}
