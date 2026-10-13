# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP server (stdio transport) exposing ScreenshotAPI (screenshotapi.net) as 8 MCP tools. Published to npm as `@screenshotapinet/mcp`, run by clients via `npx`. TypeScript, ESM (`"type": "module"`), Node >= 18, no test suite or linter configured. Sibling project to `@commoditypriceapi/mcp` and `@currencyfreaks/mcp` and follows the same layout.

## Commands

```bash
npm run build   # tsc → dist/, then chmod +x dist/cli.js
npm run dev     # tsc --watch
npm start       # node dist/cli.js (requires SCREENSHOTAPI_TOKEN env var)

# Manual testing with the MCP Inspector:
SCREENSHOTAPI_TOKEN=<KEY> npx @modelcontextprotocol/inspector node dist/cli.js
```

## Architecture

Three-layer flow, one file each in `src/`:

- `cli.ts`: bin entry point. Creates the server and connects it to `StdioServerTransport`. **stdout is reserved for the MCP protocol stream, so all logging must go to stderr** (`console.error`).
- `server.ts`: `createServer()` registers all 8 tools on an `McpServer`, with zod input schemas built from shared shapes (`targetShape`, `viewportShape`, `timingShape`, `manipulationShape`, `blockingShape`, `emulationShape`, `cachingShape`, `storageShape`). Every handler is a try/catch: success → `textResult()`, failure → `errorResult()`.
- `client.ts`: three HTTP functions.
  - `renderScreenshot(params)` hits `https://shot.screenshotapi.net/v3/screenshot` and always forces `output=json`, so responses carry hosted file URLs instead of raw bytes. Nested objects are flattened to bracket notation (`clip[x]`, `pdf_options[format]`) and arrays to JSON strings (`sizes=[...]`), matching the doc examples. If the GET URL would exceed `MAX_GET_URL_LENGTH`, it switches to POST with a JSON body (`{ token, ...params }`), which the API also accepts.
  - `callBulkApi(path, request)` hits `https://api.screenshotapi.net/v1/bulk/*` (`/json`, `/csv` multipart with field `csv`, `/csv/status`, `/csv/download`). Non-JSON bodies such as the CSV download come back as strings.
  - `downloadFile(url, maxBytes)` fetches hosted output from storage without the token.
  The token is read from `SCREENSHOTAPI_TOKEN` at call time, not at startup. `redactToken()` strips `token` keys from every response before it reaches the model.

`index.ts` is the library export (`createServer` only).

### Tool-specific behavior

- `take_screenshot` downloads the image and returns it as MCP `image` content. It skips the inline image when `full_page` is set unless `include_image=true`, and when the file is over `SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES`. Download failures never fail the call; they show up as `download_note` next to the still-valid URL.
- `generate_pdf` sends `file_type=pdf` and packs `format/landscape/page_range/print_background/media` into `pdf_options[...]`, as in the doc's example URL. The doc's parameter headings use the bare names (`format`, `page_range`, `landscape`). If PDFs ignore these options, check whether the API wants the top-level names.
- `scrape_page` maps `extract` to `extract_markdown/extract_text/extract_html/get_image_urls`. The docs don't name the response fields, so it scans the JSON for `.md/.txt/.html` file URLs and fetches them.
- `record_scrolling_video` sets `scrolling_screenshot=true`. `sizes` also sets `multiple_scrolling=true` and sends `[{id, width, height}]` with string dimensions.
- `findFileUrl()` prefers the `screenshot` field and falls back to any `storage.` URL in the response.
- The `block` list expands to individual flags via `BLOCK_FLAGS`. Note the API's irregular names: `no_cookie_banners`, `block_font`, `block_text_track`, `block_web_socket`.

### Error-handling contract

Tool calls must never crash the server. `client.ts` normalizes every failure into `ScreenshotApiError { code, errorType, message, path }`. Error shapes seen on the live API:

- The render endpoint uses `{ timestamp, status, error, message, path }`, where `error` is a code like `token_required` or `invalid_url`.
- An unknown token returns HTTP 400 with only `{ error: "Unauthorized ..." }`, which is remapped to 401 `invalid_token`.
- The bulk API returns auth failures as **HTTP 200** `{ error: "Authorization error" }`. Small 2xx bodies with only an `error` key are treated as failures.

`guidanceFor()` in `server.ts` maps the documented error codes (https://www.screenshotapi.net/docs/errors) and status codes to actionable advice. Keep this contract when adding tools: wrap the handler body in try/catch and route errors through `errorResult()`.

### Adding a tool or parameter

Register tools in `createServer()` with `server.registerTool(name, { title, description, inputSchema }, handler)`. New render parameters go into the matching shared shape so every render tool picks them up. Use the API's exact parameter name as the schema key, because `...args` is passed through to the API unchanged. Update the tool tables in README.md.
