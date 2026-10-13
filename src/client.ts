const SCREENSHOT_URL = "https://shot.screenshotapi.net/v3/screenshot";
const BULK_BASE_URL = "https://api.screenshotapi.net/v1/bulk";

/**
 * GET is the documented request style, but long values (custom_html, js, css)
 * can exceed URL length limits. Above this length the request is sent as a
 * POST with a JSON body instead, which the API also accepts.
 */
const MAX_GET_URL_LENGTH = 6000;

export type ParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ParamValue[]
  | { [key: string]: ParamValue };

export type Params = Record<string, ParamValue>;

export class ScreenshotApiError extends Error {
  code: number;
  errorType: string;
  path?: string;

  constructor(code: number, errorType: string, message: string, path?: string) {
    super(message);
    this.name = "ScreenshotApiError";
    this.code = code;
    this.errorType = errorType;
    this.path = path;
  }
}

function getToken(): string {
  const token = process.env.SCREENSHOTAPI_TOKEN;
  if (!token) {
    throw new ScreenshotApiError(
      401,
      "token_required",
      "SCREENSHOTAPI_TOKEN is not set. Add it to your MCP client config's env block. Get your API key from the dashboard at https://app.screenshotapi.net."
    );
  }
  return token;
}

function timeoutMs(): number {
  return Number(process.env.SCREENSHOTAPI_REQUEST_TIMEOUT_MS ?? 180000);
}

function isEmpty(value: ParamValue): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Flattens params into query-string pairs. Nested objects use bracket
 * notation (clip[x]=10, pdf_options[format]=A4) as in the API docs; arrays are
 * sent as a JSON string (sizes=[{...}]).
 */
function flattenParams(params: Params, prefix = ""): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (isEmpty(value)) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      pairs.push([name, JSON.stringify(value)]);
    } else if (typeof value === "object") {
      pairs.push(...flattenParams(value as Params, name));
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

function compactParams(params: Params): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    if (isEmpty(value)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = compactParams(value as Params);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else if (Array.isArray(value)) {
      // Match the GET encoding, where arrays travel as JSON strings.
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Removes the API token from anything echoed back by the API so it never ends
 * up in the model's context.
 */
export function redactToken<T>(data: T): T {
  if (Array.isArray(data)) return data.map(redactToken) as T;
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "token") continue;
      out[key] = redactToken(value);
    }
    return out as T;
  }
  return data;
}

async function timedFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const ms = timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ScreenshotApiError(
        499,
        "request_timeout",
        `Request to ${label} timed out after ${ms}ms.`
      );
    }
    throw new ScreenshotApiError(
      502,
      "upstream_unreachable",
      `Could not reach ${label}: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalizes every upstream failure into ScreenshotApiError.
 *
 * The screenshot endpoint uses the envelope { timestamp, status, error,
 * message, path } where `error` is a code such as `invalid_url`. Some failures
 * (an unknown token, bulk auth) return only { error: "<text>" }, and the bulk
 * API returns them with HTTP 200, so a 2xx body with `error` and nothing else
 * useful is treated as a failure too.
 */
function toApiError(status: number, body: any): ScreenshotApiError {
  const rawError = typeof body?.error === "string" ? body.error : undefined;
  const message =
    (typeof body?.message === "string" && body.message) ||
    rawError ||
    `ScreenshotAPI request failed with status ${status}.`;

  // Unknown or revoked tokens come back as a free-text error, not a code.
  if (rawError && /unauthori[sz]ed|authori[sz]ation error/i.test(rawError)) {
    return new ScreenshotApiError(401, "invalid_token", message, body?.path);
  }

  const code = typeof body?.status === "number" ? body.status : status >= 400 ? status : 400;
  return new ScreenshotApiError(code, rawError ?? "unknown_error", message, body?.path);
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      throw new ScreenshotApiError(
        response.status,
        "invalid_response",
        `ScreenshotAPI returned a non-JSON error response: ${text.slice(0, 500)}`
      );
    }
    return text;
  }

  if (!response.ok) throw toApiError(response.status, body);

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof body.error === "string" &&
    Object.keys(body).length <= 2
  ) {
    throw toApiError(response.status, body);
  }

  return body;
}

/**
 * Calls the render endpoint (screenshots, PDFs, scrolling videos, scraping).
 * Always requests output=json so the result carries the hosted file URL and
 * any extracted content URLs rather than raw bytes.
 */
export async function renderScreenshot<T = any>(params: Params): Promise<T> {
  const token = getToken();
  const all: Params = { ...params, output: "json" };

  const url = new URL(SCREENSHOT_URL);
  url.searchParams.set("token", token);
  for (const [key, value] of flattenParams(all)) {
    url.searchParams.append(key, value);
  }

  const useGet = url.toString().length <= MAX_GET_URL_LENGTH;
  const response = useGet
    ? await timedFetch(url.toString(), { method: "GET", headers: { accept: "application/json" } }, "ScreenshotAPI")
    : await timedFetch(
        SCREENSHOT_URL,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ token, ...compactParams(all) }),
        },
        "ScreenshotAPI"
      );

  return (await parseJsonResponse(response)) as T;
}

type BulkRequest =
  | { method: "GET"; query?: Record<string, string> }
  | { method: "POST"; json: unknown }
  | { method: "POST"; form: FormData };

/**
 * Calls a bulk endpoint under https://api.screenshotapi.net/v1/bulk. The token
 * goes in the query string for every method (and in the JSON body for
 * /json, matching the documented examples). Returns parsed JSON, or the raw
 * text for non-JSON bodies such as the CSV download.
 */
export async function callBulkApi<T = any>(path: string, request: BulkRequest): Promise<T> {
  const token = getToken();
  const url = new URL(BULK_BASE_URL + path);
  url.searchParams.set("token", token);

  let init: RequestInit;
  if (request.method === "GET") {
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value);
    }
    init = { method: "GET" };
  } else if ("form" in request) {
    init = { method: "POST", body: request.form };
  } else {
    init = {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ token, ...(request.json as object) }),
    };
  }

  const response = await timedFetch(url.toString(), init, "ScreenshotAPI bulk API");
  return (await parseJsonResponse(response)) as T;
}

export type DownloadedFile = {
  bytes: Buffer;
  contentType: string;
};

/**
 * Downloads a rendered file (image, PDF, video, extracted text) from its
 * hosted storage URL. Storage URLs are public, so no token is sent. Throws if
 * the file is larger than maxBytes so callers can fall back to just the URL.
 */
export async function downloadFile(fileUrl: string, maxBytes: number): Promise<DownloadedFile> {
  const response = await timedFetch(fileUrl, { method: "GET" }, "ScreenshotAPI storage");
  if (!response.ok) {
    throw new ScreenshotApiError(
      response.status,
      "download_failed",
      `Could not download ${fileUrl} (HTTP ${response.status}).`
    );
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new ScreenshotApiError(
      413,
      "file_too_large",
      `File is ${declared} bytes, above the ${maxBytes}-byte limit.`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new ScreenshotApiError(
      413,
      "file_too_large",
      `File is ${bytes.length} bytes, above the ${maxBytes}-byte limit.`
    );
  }

  return {
    bytes,
    contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim(),
  };
}
