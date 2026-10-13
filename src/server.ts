import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callBulkApi,
  downloadFile,
  redactToken,
  renderScreenshot,
  ScreenshotApiError,
  type Params,
} from "./client.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Largest image returned inline to the model (base64 adds ~33% on top). */
function maxInlineImageBytes(): number {
  return Number(process.env.SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES ?? 3_500_000);
}

/** Largest file written to disk via save_path. */
const MAX_SAVE_BYTES = 200 * 1024 * 1024;

/** Largest extracted text/Markdown/HTML file fetched for scrape_page. */
const MAX_EXTRACT_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Shared input schemas
// ---------------------------------------------------------------------------

const targetShape = {
  url: z
    .string()
    .optional()
    .describe(
      "Website URL to render, including the protocol, e.g. 'https://example.com'. Either url or custom_html is required."
    ),
  custom_html: z
    .string()
    .optional()
    .describe(
      "Raw HTML to render instead of loading a URL. Takes precedence over url. Inline CSS and JavaScript in the HTML are applied. Useful for pages that are not publicly reachable."
    ),
};

const viewportShape = {
  width: z
    .number()
    .int()
    .positive()
    .max(7680)
    .optional()
    .describe("Browser viewport width in pixels (max 7680). Default 1680. Use ~390 to emulate a phone, ~768 for a tablet."),
  height: z
    .number()
    .int()
    .positive()
    .max(4320)
    .optional()
    .describe("Browser viewport height in pixels (max 4320). Default 876."),
};

const timingShape = {
  delay: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Extra wait in milliseconds after the page loads, before capture. Default 0. Use 1000-5000 for animations, charts, or late-loading content."),
  wait_for_event: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .describe(
      "Page lifecycle event to wait for before capture. 'load' (default) waits for all resources; 'domcontentloaded' is faster but may miss images; 'networkidle' waits until no network requests for 500ms — best for SPAs and dashboards."
    ),
  lazy_load: z
    .boolean()
    .optional()
    .describe("Scroll through the whole page first so lazy-loaded images and sections render. Default false."),
  scroll_delay: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Milliseconds to wait between scroll steps when lazy_load is true. Default 500. High values on long pages can hit the timeout."),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum milliseconds the API waits for the page to load before aborting. Default 100000."),
};

const manipulationShape = {
  css: z
    .string()
    .optional()
    .describe("CSS injected before capture, e.g. '.header { display: none; }'."),
  css_url: z.string().optional().describe("URL of an external stylesheet to inject before capture."),
  js: z
    .string()
    .optional()
    .describe("JavaScript executed in the page before capture, e.g. \"document.querySelector('.popup').remove();\"."),
  js_url: z.string().optional().describe("URL of an external JavaScript file to execute before capture."),
  remove_selector: z
    .string()
    .optional()
    .describe("CSS selector(s) of elements to remove from the page before capture, comma-separated, e.g. '.ad-banner, #sidebar'. Non-matching selectors are ignored."),
  blur_selector: z
    .string()
    .optional()
    .describe("CSS selector(s) of elements to blur, comma-separated — for redacting emails, account numbers, or other sensitive data."),
  selector_to_click: z
    .string()
    .optional()
    .describe("CSS selector of an element to click before capture, e.g. to open a tab, dropdown, or accordion."),
  click_recursion: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("How many times to click selector_to_click in sequence. Requires selector_to_click. Default 0."),
  scroll_to_element: z
    .string()
    .optional()
    .describe("CSS selector of an element to scroll into view before a viewport capture."),
  adjust_top: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Scroll the viewport down this many pixels before capture. Default 0. Not supported for PDFs."),
};

const BLOCK_FLAGS = {
  ads: "block_ads",
  tracking: "block_tracking",
  cookie_banners: "no_cookie_banners",
  chat_widgets: "block_chat_widgets",
  javascript: "block_js",
  stylesheets: "block_stylesheets",
  images: "block_images",
  media: "block_media",
  fonts: "block_font",
  text_tracks: "block_text_track",
  xhr: "block_xhr",
  fetch: "block_fetch",
  event_source: "block_event_source",
  websockets: "block_web_socket",
  manifest: "block_manifest",
} as const;

type BlockKind = keyof typeof BLOCK_FLAGS;

const blockingShape = {
  block: z
    .array(z.enum(Object.keys(BLOCK_FLAGS) as [BlockKind, ...BlockKind[]]))
    .optional()
    .describe(
      "Resources to block while rendering. For a clean capture use ['ads', 'cookie_banners', 'chat_widgets']. 'tracking' blocks analytics. 'javascript', 'stylesheets', 'xhr', and 'fetch' can break pages or hide content — use only when needed. Others: images, media (audio/video), fonts, text_tracks, event_source, websockets, manifest."
    ),
  block_specific_requests: z
    .string()
    .optional()
    .describe("Specific request URLs or patterns to block, separated by commas, spaces, or newlines, e.g. 'https://example.com/api/data, https://ads-domain.com'."),
};

const emulationShape = {
  dark_mode: z.boolean().optional().describe("Render with the dark color scheme (for sites that support it). Default false."),
  grayscale: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Desaturate the output, 0 (full color, default) to 100 (fully grayscale)."),
  enable_incognito: z
    .boolean()
    .optional()
    .describe("Render in an isolated incognito session with no persisted cookies or storage. Default false."),
  user_agent: z.string().optional().describe("Custom User-Agent string, e.g. a mobile Safari UA to get the mobile site."),
  accept_languages: z
    .string()
    .optional()
    .describe("Accept-Language header for localized content, e.g. 'fr-FR,fr;q=0.9'. Default 'en-US,en;q=0.8'."),
  headers: z
    .string()
    .optional()
    .describe("Extra HTTP headers as 'Name: value;' pairs separated by semicolons, e.g. 'Authorization: Bearer abc; X-Test: 1;'."),
  cookies: z
    .string()
    .optional()
    .describe("Cookies to set before loading, as 'name=value; other=value;'. Use for pages behind a login."),
  template_id: z
    .string()
    .optional()
    .describe("ID of a saved cookie template from the ScreenshotAPI dashboard to apply before navigation."),
  proxy: z
    .string()
    .optional()
    .describe("Proxy to route the request through: 'address:port' or 'username:password@address:port' (an http:// prefix is accepted). Useful for geo-specific content or CAPTCHA-prone sites."),
  latitude: z.number().min(-90).max(90).optional().describe("Latitude reported by the browser Geolocation API."),
  longitude: z.number().min(-180).max(180).optional().describe("Longitude reported by the browser Geolocation API."),
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone to emulate, e.g. 'America/New_York', 'Asia/Karachi'. Default is the server timezone."),
};

const cachingShape = {
  fresh: z
    .boolean()
    .optional()
    .describe("true (default) always renders a new capture; false returns a cached capture when one exists from a request with enable_caching=true and identical parameters."),
  enable_caching: z
    .boolean()
    .optional()
    .describe("Store this capture in the cache for reuse. Cached captures served later (with fresh=false) do not consume credits. Default false."),
  ttl: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cache lifetime in seconds when enable_caching is true. Default 2592000 (30 days)."),
};

const storageShape = {
  result_file_name: z
    .string()
    .optional()
    .describe("Custom file name for the stored output. Non-unique names can overwrite earlier files."),
  byob: z
    .boolean()
    .optional()
    .describe("Save the output to your own bucket configured under Storage Integrations in the dashboard (Bring Your Own Bucket). Default false."),
  storage_service: z
    .string()
    .optional()
    .describe("Storage service to use with byob when several are configured: 'aws', 'wasabi', or 'google_cloud'."),
  bucket_name: z
    .string()
    .optional()
    .describe("Bucket to use with byob when several are configured under the same service."),
};

const commonShape = {
  ...timingShape,
  ...manipulationShape,
  ...blockingShape,
  ...emulationShape,
  ...cachingShape,
  ...storageShape,
};

const savePathParam = z
  .string()
  .optional()
  .describe(
    "Optional local path to also save the file to, e.g. './shots/home.png'. A directory path (ending in '/' or an existing directory) keeps the remote file name. Relative paths resolve against the MCP server's working directory."
  );

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function textResult(data: unknown, extra: Content[] = []) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ...extra,
    ],
  };
}

function errorResult(err: unknown) {
  if (err instanceof ScreenshotApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: err.errorType,
              code: err.code,
              message: err.message,
              guidance: guidanceFor(err.code, err.errorType, err.message),
            },
            null,
            2
          ),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: "unexpected_error", message: (err as Error).message },
          null,
          2
        ),
      },
    ],
  };
}

function guidanceFor(code: number, errorType: string, message: string): string {
  const type = errorType.toLowerCase();
  const msg = message.toLowerCase();

  switch (type) {
    case "token_required":
      return "Set SCREENSHOTAPI_TOKEN in your MCP client config's env block. Copy the API key from the dashboard at https://app.screenshotapi.net.";
    case "invalid_token":
      return "The API key was rejected. Check SCREENSHOTAPI_TOKEN in your MCP client config; if you rolled the key in the dashboard, the old one no longer works.";
    case "url_required":
    case "invalid_url":
      return "Pass a fully qualified URL including the protocol, e.g. 'https://example.com', or pass custom_html instead.";
    case "invalid_file_type":
    case "invalid_scrolling_file_type":
      return "Screenshots support png, jpg, and webp; PDFs use generate_pdf; scrolling videos support mp4, webm, and gif only.";
    case "invalid_proxy":
    case "network_connection_failed":
    case "err_tunnel_connection_failed":
      return "The proxy could not be used. Use 'address:port' or 'username:password@address:port' and confirm the proxy is reachable, or retry without a proxy.";
    case "invalid_geolocation_parameter":
      return "Latitude must be between -90 and 90 and longitude between -180 and 180.";
    case "invalid_css_url":
    case "invalid_js_url":
      return "css_url and js_url must be valid, publicly reachable URLs.";
    case "invalid_js_code":
      return "The injected JavaScript failed to parse or run. Check the js parameter for syntax errors.";
    case "invalid_clipped_area":
      return "The clip rectangle is invalid. x and y must be within the page and width/height must be positive.";
    case "invalid_input_syntax":
      return "A numeric parameter received a non-integer value.";
    case "feature_not_supported":
      return "Content extraction is not available for video or GIF output. Use scrape_page (image output) instead of record_scrolling_video.";
    case "invalid_parameter":
      return "A parameter combination is invalid for this request, e.g. 'sizes' without multiple capture enabled. Check the tool's parameter notes.";
    case "template_not_found":
      return "The cookie template ID was not found. Check template_id against the templates in your dashboard.";
    case "subscription_inactive":
      return "The ScreenshotAPI subscription is inactive. Reactivate or upgrade the plan at https://www.screenshotapi.net/pricing.";
    case "trial_expired":
      return "The free trial has ended. Upgrade to a paid plan at https://www.screenshotapi.net/pricing to keep capturing.";
    case "team_not_found":
      return "This account is not on a plan or free trial. Sign up at https://www.screenshotapi.net to activate one.";
    case "too_many_redirects":
      return "The target URL redirects in a loop. Try the final destination URL directly.";
    case "file_too_large":
      return "The rendered file was too large to download here. Use the returned URL directly, request a smaller capture (thumbnail_width, a lower image_quality, or no full_page), or raise SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES.";
  }

  if (type.startsWith("err_ssl") || type.includes("ssl_version")) {
    return "The target site has an SSL/TLS problem (expired, mismatched, or incompatible certificate). The site must fix it; retrying won't help.";
  }
  if (type.startsWith("err_")) {
    return "The target site could not be loaded (refused, unreachable, closed the connection, or returned nothing). Check that the URL is up, or try routing through a proxy.";
  }

  switch (code) {
    case 400:
      return "One or more parameters are invalid. Check the URL, selectors, and numeric values against the tool description.";
    case 401:
      return "Authentication failed. Check SCREENSHOTAPI_TOKEN in your MCP client config.";
    case 402:
      return "The service is paused for unpaid dues or because usage reached twice the plan quota. Settle billing or upgrade at https://www.screenshotapi.net/pricing.";
    case 403:
      if (msg.includes("quota") || type === "screenshots_limit_reached") {
        return "The plan's screenshot quota is used up. Upgrade the plan or raise the overage limit in the dashboard.";
      }
      return "Access was refused. Check the plan status in the dashboard.";
    case 408:
      return "Rendering took too long. Raise the timeout parameter, lower delay/scroll_delay, or use wait_for_event='domcontentloaded'.";
    case 429:
      return "Too many requests per minute for this plan. Wait a moment and retry.";
    case 499:
      return "This MCP server stopped waiting for ScreenshotAPI. Retry, or raise SCREENSHOTAPI_REQUEST_TIMEOUT_MS (default 180000).";
    case 500:
      return "ScreenshotAPI had an internal error. Retrying is safe; contact info@screenshotapi.net if it persists.";
    case 502:
      return "ScreenshotAPI could not be reached. Check network connectivity and retry.";
    case 503:
      return "ScreenshotAPI or the target page is temporarily unavailable. Retry shortly.";
    default:
      return "ScreenshotAPI returned an error outside the documented cases; treat the message above as authoritative.";
  }
}

function requireTarget(url?: string, customHtml?: string) {
  if (!url && !customHtml) {
    throw new ScreenshotApiError(400, "url_required", "Provide either 'url' or 'custom_html'.");
  }
}

/** Expands the block list into the API's individual boolean flags. */
function blockFlags(block?: BlockKind[]): Params {
  const flags: Params = {};
  for (const kind of block ?? []) flags[BLOCK_FLAGS[kind]] = true;
  return flags;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * Finds the hosted output file in a render response. The documented field is
 * `screenshot`; any other storage URL is used as a fallback.
 */
function findFileUrl(result: any): string | undefined {
  if (isHttpUrl(result?.screenshot)) return result.screenshot;
  if (result && typeof result === "object") {
    for (const [key, value] of Object.entries(result)) {
      if (key !== "url" && isHttpUrl(value) && value.includes("storage.")) return value;
    }
  }
  return undefined;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function imageMimeType(fileUrl: string, contentType: string): string | undefined {
  if (contentType.startsWith("image/")) return contentType;
  return MIME_BY_EXT[extname(new URL(fileUrl).pathname).toLowerCase()];
}

async function saveFile(savePath: string, fileUrl: string, bytes: Buffer): Promise<string> {
  let target = resolve(savePath);
  const isDir =
    /[\\/]$/.test(savePath) ||
    (await stat(target).then((s) => s.isDirectory()).catch(() => false));
  if (isDir) target = resolve(target, basename(new URL(fileUrl).pathname) || "screenshotapi-output");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

/**
 * Downloads the rendered file when it needs to be saved locally and/or shown
 * to the model inline. Download problems never fail the tool call — the
 * hosted URL is still valid — so they are reported as notes instead.
 */
async function deliverFile(
  fileUrl: string | undefined,
  opts: { savePath?: string; inline: boolean }
): Promise<{ notes: Record<string, unknown>; content: Content[] }> {
  const notes: Record<string, unknown> = {};
  const content: Content[] = [];
  if (!fileUrl || (!opts.savePath && !opts.inline)) return { notes, content };

  const inlineLimit = maxInlineImageBytes();
  try {
    const file = await downloadFile(fileUrl, opts.savePath ? MAX_SAVE_BYTES : inlineLimit);
    if (opts.savePath) notes.saved_to = await saveFile(opts.savePath, fileUrl, file.bytes);
    if (opts.inline) {
      const mimeType = imageMimeType(fileUrl, file.contentType);
      if (!mimeType) {
        notes.image_note = "Output is not an image, so it is not shown inline.";
      } else if (file.bytes.length > inlineLimit) {
        notes.image_note = `Image is ${file.bytes.length} bytes, above the ${inlineLimit}-byte inline limit. Open the URL instead, or request a smaller capture (thumbnail_width, jpg with lower image_quality).`;
      } else {
        content.push({ type: "image", data: file.bytes.toString("base64"), mimeType });
      }
    }
  } catch (err) {
    notes.download_note =
      err instanceof ScreenshotApiError && err.errorType === "file_too_large"
        ? `${err.message} The file is still available at the URL above.`
        : `Could not download the rendered file: ${(err as Error).message}. The URL above is still valid.`;
  }
  return { notes, content };
}

/** Minimal RFC 4180 CSV parser for the bulk results download. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) =>
    Object.fromEntries(keys.map((k, idx) => [k, (r[idx] ?? "").trim()]))
  );
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: "screenshotapi-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "take_screenshot",
    {
      title: "Take a website screenshot",
      description:
        "Captures a screenshot of a web page (or of raw HTML) in a real browser and returns the hosted image URL. By default the image is also returned inline so you can see it — except for full_page captures, which are often too tall to view; set include_image=true to force it. " +
        "Supports viewport or full-page capture, a single element via 'selector', a pixel region via 'clip', retina output, ad/cookie-banner blocking, CSS/JS injection, clicking elements first, dark mode, custom headers/cookies, proxies, geolocation, and timezone. Each call uses one screenshot credit unless a cached capture is served.",
      inputSchema: {
        ...targetShape,
        file_type: z
          .enum(["png", "jpg", "webp"])
          .optional()
          .describe("Image format. Default png. jpg is smallest (see image_quality); webp balances size and quality. For PDF use generate_pdf."),
        full_page: z
          .boolean()
          .optional()
          .describe("Capture the entire scrollable page instead of just the viewport. Default false. Combine with lazy_load for pages with lazy images."),
        ...viewportShape,
        retina: z.boolean().optional().describe("Render at 2x pixel density for a sharper, larger image. Default false."),
        image_quality: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("JPEG compression quality 0-100 (jpg only). Default 80."),
        omit_background: z
          .boolean()
          .optional()
          .describe("Make plain white/solid page backgrounds transparent (png only). Default false."),
        thumbnail_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Resize the output to this width in pixels, keeping the aspect ratio. Handy for previews and to keep inline images small."),
        selector: z
          .string()
          .optional()
          .describe("CSS selector of a single element to capture instead of the viewport, e.g. '#pricing' or '.product-card'."),
        clip: z
          .object({
            x: z.number().int().min(0).describe("Left edge in pixels."),
            y: z.number().int().min(0).describe("Top edge in pixels."),
            width: z.number().int().positive().describe("Region width in pixels."),
            height: z.number().int().positive().describe("Region height in pixels."),
          })
          .optional()
          .describe("Capture only this rectangle of the page."),
        sizes: z
          .array(
            z.object({
              width: z.number().int().positive().describe("Viewport width in pixels."),
              height: z.number().int().positive().describe("Viewport height in pixels."),
            })
          )
          .min(1)
          .max(10)
          .optional()
          .describe("Capture the page at several viewport sizes in one request, e.g. [{width:1920,height:1080},{width:768,height:1024},{width:390,height:844}]. Overrides width/height. Returns one hosted image per size; images are not shown inline in this mode."),
        ...commonShape,
        include_image: z
          .boolean()
          .optional()
          .describe("Return the image inline in the tool result so you can see it. Default true, or false when full_page is true. Images above SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES (default 3500000 bytes) are returned as a URL only."),
        save_path: savePathParam,
      },
    },
    async ({ include_image, save_path, block, sizes, ...args }) => {
      try {
        requireTarget(args.url, args.custom_html);
        const params: Params = { ...args, ...blockFlags(block) };
        if (sizes) {
          params.multiple_screenshot = true;
          params.sizes = sizes.map((s, i) => ({ id: i + 1, width: String(s.width), height: String(s.height) }));
          const result = await renderScreenshot(params);
          return textResult({ response: redactToken(result) });
        }
        const result = await renderScreenshot(params);
        const fileUrl = findFileUrl(result);
        const inline = include_image ?? !args.full_page;
        const { notes, content } = await deliverFile(fileUrl, { savePath: save_path, inline });
        return textResult({ screenshot: fileUrl, ...notes, response: redactToken(result) }, content);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "generate_pdf",
    {
      title: "Convert a web page or HTML to PDF",
      description:
        "Renders a URL or raw HTML in a real browser and converts it to a PDF, returning the hosted PDF URL. Choose a paper size ('format') for paginated output; without format (and without width/height) the whole page becomes one long continuous PDF page. " +
        "Supports landscape, page ranges, print backgrounds, print vs screen CSS, and all page preparation options (delay, lazy_load, ad/cookie-banner blocking, CSS/JS injection). Use save_path to save the PDF locally.",
      inputSchema: {
        ...targetShape,
        format: z
          .enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "Letter", "Legal", "Tabloid", "Ledger"])
          .optional()
          .describe("Paper size. A4 or Letter for documents and invoices. Omit for a single continuous page."),
        landscape: z.boolean().optional().describe("Landscape orientation — good for wide tables and dashboards. Default false (portrait)."),
        page_range: z
          .string()
          .regex(/^\d+-\d+$/, "page_range must look like '2-6'.")
          .optional()
          .describe("Keep only these pages, as 'start-end', e.g. '1-3' or '5-5'. Needs a paginated PDF (format or width/height)."),
        print_background: z
          .boolean()
          .optional()
          .describe("Include background colors and images in the PDF."),
        media: z
          .enum(["screen", "print"])
          .optional()
          .describe("CSS media type to emulate: 'print' uses the site's print stylesheet, 'screen' matches what a visitor sees."),
        ...viewportShape,
        ...commonShape,
        save_path: savePathParam,
      },
    },
    async ({ save_path, block, format, landscape, page_range, print_background, media, ...args }) => {
      try {
        requireTarget(args.url, args.custom_html);
        const result = await renderScreenshot({
          ...args,
          ...blockFlags(block),
          file_type: "pdf",
          pdf_options: { format, landscape, page_range, print_background, media },
        });
        const fileUrl = findFileUrl(result);
        const { notes } = await deliverFile(fileUrl, { savePath: save_path, inline: false });
        return textResult({ pdf: fileUrl, ...notes, response: redactToken(result) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  const EXTRACT_FLAGS = {
    markdown: "extract_markdown",
    text: "extract_text",
    html: "extract_html",
    image_urls: "get_image_urls",
  } as const;
  type ExtractKind = keyof typeof EXTRACT_FLAGS;

  server.registerTool(
    "scrape_page",
    {
      title: "Scrape page content as Markdown, text, or HTML",
      description:
        "Loads a page in a real browser (JavaScript executed) and extracts its content: clean Markdown (best for reading and summarizing), plain text, the fully rendered HTML, and/or every image URL on the page. Extracted files are fetched and returned inline, truncated to max_content_chars. " +
        "Works on JavaScript-heavy sites that plain HTTP fetches can't read. A screenshot is captured as part of the same request and counts as one credit.",
      inputSchema: {
        ...targetShape,
        extract: z
          .array(z.enum(Object.keys(EXTRACT_FLAGS) as [ExtractKind, ...ExtractKind[]]))
          .min(1)
          .optional()
          .describe("What to extract. Default ['markdown']. Options: markdown, text, html, image_urls."),
        include_content: z
          .boolean()
          .optional()
          .describe("Fetch the extracted files and return their contents inline. Default true. false returns only the file URLs."),
        max_content_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Truncate each extracted file to this many characters. Default 50000."),
        ...viewportShape,
        ...timingShape,
        ...manipulationShape,
        ...blockingShape,
        ...emulationShape,
      },
    },
    async ({ extract, include_content, max_content_chars, block, ...args }) => {
      try {
        requireTarget(args.url, args.custom_html);
        const kinds = extract ?? ["markdown"];
        const flags: Params = {};
        for (const kind of kinds) flags[EXTRACT_FLAGS[kind]] = true;

        const result = await renderScreenshot({ ...args, ...blockFlags(block), ...flags });
        const screenshot = findFileUrl(result);

        // Extracted content comes back as hosted .md/.txt/.html file URLs.
        const files: Record<string, string> = {};
        for (const [key, value] of Object.entries(result ?? {})) {
          if (key === "url" || !isHttpUrl(value) || value === screenshot) continue;
          if (/\.(md|markdown|txt|html?)$/i.test(new URL(value).pathname)) files[key] = value;
        }

        const extracted: Record<string, unknown> = {};
        if (include_content ?? true) {
          const limit = max_content_chars ?? 50000;
          for (const [key, fileUrl] of Object.entries(files)) {
            try {
              const file = await downloadFile(fileUrl, MAX_EXTRACT_BYTES);
              const text = file.bytes.toString("utf8");
              extracted[key] =
                text.length > limit
                  ? { content: text.slice(0, limit), truncated: true, total_chars: text.length }
                  : { content: text };
            } catch (err) {
              extracted[key] = { error: (err as Error).message, url: fileUrl };
            }
          }
        }

        return textResult({
          extracted,
          screenshot,
          response: redactToken(result),
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "record_scrolling_video",
    {
      title: "Record a scrolling video of a web page",
      description:
        "Records a video (mp4, webm, or gif) of the browser scrolling down a web page and returns the hosted video URL. Control scroll speed, duration, and scrolling back to the top. Set video=true to record the viewport without scrolling (for animations or live dashboards). " +
        "Pass 'sizes' to record the same page at several viewport sizes in one request. Rendering takes noticeably longer than a screenshot.",
      inputSchema: {
        ...targetShape,
        file_type: z.enum(["mp4", "webm", "gif"]).optional().describe("Video format. Default mp4. gif loops and has no sound; webm is smaller."),
        scroll_speed: z.enum(["slow", "normal", "fast"]).optional().describe("Scrolling speed. Default normal."),
        duration: z
          .number()
          .min(0)
          .max(60)
          .optional()
          .describe("How long the scrolling (or viewport recording) lasts, in seconds, 0-60."),
        scroll_back: z.boolean().optional().describe("Scroll back up to the top after reaching the bottom. Default false."),
        start_immediately: z
          .boolean()
          .optional()
          .describe("Start recording as soon as navigation begins instead of after load, to capture the page loading. Default false."),
        video: z
          .boolean()
          .optional()
          .describe("Record the visible viewport for 'duration' seconds without scrolling. Default false."),
        ...viewportShape,
        sizes: z
          .array(
            z.object({
              width: z.number().int().positive().describe("Viewport width in pixels."),
              height: z.number().int().positive().describe("Viewport height in pixels."),
            })
          )
          .min(1)
          .max(10)
          .optional()
          .describe("Record one video per viewport size, e.g. [{width:1920,height:1080},{width:390,height:844}]. Overrides width/height."),
        ...timingShape,
        ...manipulationShape,
        ...blockingShape,
        ...emulationShape,
        save_path: savePathParam.describe(
          "Optional local path to save the video to (ignored when 'sizes' is used, since that returns several files)."
        ),
      },
    },
    async ({ save_path, block, sizes, ...args }) => {
      try {
        requireTarget(args.url, args.custom_html);
        const params: Params = { ...args, ...blockFlags(block), scrolling_screenshot: true };
        if (sizes) {
          params.multiple_scrolling = true;
          params.sizes = sizes.map((s, i) => ({ id: i + 1, width: String(s.width), height: String(s.height) }));
        }
        const result = await renderScreenshot(params);
        const fileUrl = findFileUrl(result);
        const { notes } = sizes
          ? { notes: {} }
          : await deliverFile(fileUrl, { savePath: save_path, inline: false });
        return textResult({ video: fileUrl, ...notes, response: redactToken(result) });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  const bulkOptionValue = z.union([z.string(), z.number(), z.boolean()]);

  server.registerTool(
    "bulk_screenshots",
    {
      title: "Capture screenshots of many URLs",
      description:
        "Submits up to 50 URLs as one bulk screenshot job (JSON bulk API). Each entry is a URL plus any take_screenshot option using the raw API parameter names (file_type, width, height, full_page, fresh, delay, css, block_ads, no_cookie_banners, ...). 'defaults' are applied to every entry unless the entry overrides them. " +
        "Returns the API's job response; if it contains a uuid, track it with get_bulk_status and fetch results with download_bulk_results. Paid plans only.",
      inputSchema: {
        screenshots: z
          .array(
            z
              .object({ url: z.string().describe("URL to capture, including https://.") })
              .catchall(bulkOptionValue)
          )
          .min(1)
          .max(50)
          .describe("Entries to capture, e.g. [{url:'https://a.com'},{url:'https://b.com',full_page:true}]. Max 50."),
        defaults: z
          .record(bulkOptionValue)
          .optional()
          .describe("Options applied to every entry, e.g. {file_type:'png', width:1440, height:900, no_cookie_banners:true}."),
      },
    },
    async ({ screenshots, defaults }) => {
      try {
        const urls = screenshots.map((s) => ({ ...(defaults ?? {}), ...s }));
        const result = await callBulkApi("/json", { method: "POST", json: { urls } });
        return textResult(redactToken(result));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "bulk_screenshots_csv",
    {
      title: "Start a bulk screenshot job from a CSV",
      description:
        "Uploads a CSV to start a bulk screenshot job. The CSV must have a 'url' column with full https:// URLs; any other column is treated as a render option for that row using the API parameter names (file_type, width, height, css, delay, headers, ...). " +
        "Pass either a local csv_path or the CSV text in csv_content. Returns the job response including its uuid for get_bulk_status and download_bulk_results. ScreenshotAPI also emails a download link when the job finishes. Paid plans only.",
      inputSchema: {
        csv_path: z.string().optional().describe("Path to a local CSV file."),
        csv_content: z
          .string()
          .optional()
          .describe("CSV text, e.g. 'url,file_type\\nhttps://a.com,png\\nhttps://b.com,jpg'. Used when csv_path is not given."),
      },
    },
    async ({ csv_path, csv_content }) => {
      try {
        if (!csv_path && !csv_content) {
          throw new ScreenshotApiError(400, "csv_required", "Provide either 'csv_path' or 'csv_content'.");
        }
        const data = csv_path ? await readFile(resolve(csv_path)) : Buffer.from(csv_content!, "utf8");
        const form = new FormData();
        form.append(
          "csv",
          new Blob([data], { type: "text/csv" }),
          csv_path ? basename(csv_path) : "screenshots.csv"
        );
        const result = await callBulkApi("/csv", { method: "POST", form });
        return textResult(redactToken(result));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_bulk_status",
    {
      title: "Check a bulk screenshot job",
      description:
        "Returns the progress of a bulk screenshot job by uuid: percent complete plus successful and failed URLs. Call download_bulk_results once it reaches 100%.",
      inputSchema: {
        uuid: z.string().describe("Job uuid returned when the bulk job was submitted."),
      },
    },
    async ({ uuid }) => {
      try {
        const result = await callBulkApi("/csv/status", { method: "GET", query: { uuid } });
        return textResult(redactToken(result));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "download_bulk_results",
    {
      title: "Download bulk screenshot results",
      description:
        "Downloads the results of a finished bulk screenshot job by uuid: one row per URL with its status, the hosted screenshot URL, and any error message.",
      inputSchema: {
        uuid: z.string().describe("Job uuid returned when the bulk job was submitted."),
      },
    },
    async ({ uuid }) => {
      try {
        const result = await callBulkApi("/csv/download", { method: "GET", query: { uuid } });
        if (typeof result === "string") {
          const rows = parseCsv(result);
          return textResult({ count: rows.length, results: rows });
        }
        return textResult(redactToken(result));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
