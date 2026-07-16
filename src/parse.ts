import { parseDocument } from "yaml";
import type { ArazzoDocument } from "./types";
import { assertValidArazzo } from "./validate";

export class ArazzoDocumentError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{
      code: string;
      message: string;
      pointer: string;
    }> = [],
  ) {
    super(message);
    this.name = "ArazzoDocumentError";
  }
}

export const parseArazzo = (
  source: string | unknown,
  options?: { maxBytes?: number },
): ArazzoDocument => {
  let value = source;
  if (typeof source === "string") {
    if (
      new TextEncoder().encode(source).byteLength >
      (options?.maxBytes ?? 2_000_000)
    ) {
      throw new ArazzoDocumentError("Arazzo document is too large");
    }
    try {
      value = JSON.parse(source);
    } catch {
      const parsed = parseDocument(source, { uniqueKeys: true });
      if (parsed.errors.length > 0) {
        throw new ArazzoDocumentError(
          "Arazzo document is invalid JSON or YAML",
        );
      }
      value = parsed.toJS({ maxAliasCount: 20 });
    }
  }
  try {
    return assertValidArazzo(value);
  } catch (error) {
    if (error instanceof ArazzoDocumentError) throw error;
    throw error;
  }
};

const secureUrl = (value: string) => {
  const url = new URL(value);
  const local =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !local) || url.username || url.password) {
    throw new ArazzoDocumentError(
      "Arazzo discovery URL must use HTTPS without credentials",
    );
  }
  return url;
};

export const discoverArazzo = async (
  url: string,
  options?: {
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    headers?: HeadersInit;
    maxBytes?: number;
    timeoutMs?: number;
  },
) => {
  const response = await (options?.fetch ?? fetch)(secureUrl(url), {
    headers: {
      accept:
        "application/vnd.oai.workflows+json, application/vnd.oai.workflows+yaml, application/json, application/yaml",
      ...options?.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(options?.timeoutMs ?? 10_000),
  });
  if (!response.ok) {
    throw new ArazzoDocumentError(
      `Arazzo discovery failed with HTTP ${response.status}`,
    );
  }
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !type.includes("json") &&
    !type.includes("yaml") &&
    !type.includes("workflows")
  ) {
    throw new ArazzoDocumentError(
      "Arazzo discovery returned an unsupported media type",
    );
  }
  return parseArazzo(await response.text(), { maxBytes: options?.maxBytes });
};
