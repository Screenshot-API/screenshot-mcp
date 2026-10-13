# ScreenshotAPI MCP Server

[![npm version](https://img.shields.io/npm/v/%40screenshotapinet%2Fmcp?logo=npm&label=npm&color=CB3837)](https://www.npmjs.com/package/@screenshotapinet/mcp)
[![GitHub](https://img.shields.io/badge/GitHub-Screenshot--API-181717?logo=github)](https://github.com/Screenshot-API/screenshot-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-16A34A)](https://github.com/Screenshot-API/screenshot-mcp/blob/main/LICENSE)

Official MCP server for [ScreenshotAPI](https://www.screenshotapi.net). It gives your AI assistant 8 tools for website screenshots, URL and HTML to PDF, scrolling videos, JavaScript-aware web scraping (Markdown, text, HTML), and bulk captures. You ask in plain English and the server makes the API calls. Your assistant also gets the screenshot back as an image, so it can see the page it captured.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Cline, Codex, and any other MCP-compatible client.

| Item      | Value                |
| --------- | -------------------- |
| Package   | `@screenshotapinet/mcp` |
| Transport | `stdio`              |
| Node.js   | `>=18`               |

## Quick Start

1. [Sign up for ScreenshotAPI](https://app.screenshotapi.net) and copy your API key from the dashboard.

2. Cursor users can install in one click:

   [![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=screenshotapi&config=eyJjb21tYW5kIjoibnB4IC15IEBzY3JlZW5zaG90YXBpL21jcCIsImVudiI6eyJTQ1JFRU5TSE9UQVBJX1RPS0VOIjoiIn19)

3. Everyone else: add this to your MCP client config (see [Install by Client](#install-by-client) for the exact file path):

```json
{
  "mcpServers": {
    "screenshotapi": {
      "command": "npx",
      "args": ["-y", "@screenshotapinet/mcp"],
      "env": {
        "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
      }
    }
  }
}
```

4. Restart your client.

5. Test it: ask **"Take a screenshot of https://example.com"**

## Table of Contents

- [Quick Start](#quick-start)
- [Install by Client](#install-by-client)
- [Verify It Works](#verify-it-works)
- [Tool Reference](#tool-reference)
- [Prompt Examples](#prompt-examples)
- [Error Codes](#error-codes)
- [How It Works](#how-it-works)
- [Environment Variables](#environment-variables)
- [Building from Source](#building-from-source)
- [Troubleshooting](#troubleshooting)
- [Links](#links)
- [License](#license)

## Install by Client

### Requirements

- Node.js 18 or later
- `npx` available in your terminal
- A ScreenshotAPI API key ([sign up](https://app.screenshotapi.net))

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "screenshotapi": {
      "command": "npx",
      "args": ["-y", "@screenshotapinet/mcp"],
      "env": {
        "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

```bash
claude mcp add screenshotapi --env SCREENSHOTAPI_TOKEN=<YOUR_API_KEY> -- npx -y @screenshotapinet/mcp
```

Start a new Claude Code session after adding the server.

### Cursor

One-click install:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=screenshotapi&config=eyJjb21tYW5kIjoibnB4IC15IEBzY3JlZW5zaG90YXBpL21jcCIsImVudiI6eyJTQ1JFRU5TSE9UQVBJX1RPS0VOIjoiIn19)

Or add to `.cursor/mcp.json` manually:

```json
{
  "mcpServers": {
    "screenshotapi": {
      "command": "npx",
      "args": ["-y", "@screenshotapinet/mcp"],
      "env": {
        "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Cursor after saving.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "screenshotapi": {
      "command": "npx",
      "args": ["-y", "@screenshotapinet/mcp"],
      "env": {
        "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Windsurf after saving.

### VS Code / GitHub Copilot

Add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "screenshotapi": {
        "command": "npx",
        "args": ["-y", "@screenshotapinet/mcp"],
        "env": {
          "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
        }
      }
    }
  }
}
```

Restart VS Code after saving.

### Cline

Open MCP Servers panel → **Configure** → **Advanced MCP Settings**. Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "screenshotapi": {
      "command": "npx",
      "args": ["-y", "@screenshotapinet/mcp"],
      "env": {
        "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Restart Cline after saving.

### Codex CLI

```bash
codex mcp add screenshotapi --env SCREENSHOTAPI_TOKEN=<YOUR_API_KEY> -- npx -y @screenshotapinet/mcp
codex mcp list
```

Start a new Codex session after adding the server.

### Any Other MCP Client

Use this config:

```json
{
  "command": "npx",
  "args": ["-y", "@screenshotapinet/mcp"],
  "env": {
    "SCREENSHOTAPI_TOKEN": "<YOUR_API_KEY>"
  }
}
```

## Verify It Works

Try these after setup:

| Prompt                                                                      | Expected tool                                 |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| Take a screenshot of https://example.com                                    | `take_screenshot`                             |
| Screenshot stripe.com on an iPhone-sized screen in dark mode                | `take_screenshot` with `width`, `dark_mode`   |
| Capture the full page of https://news.ycombinator.com without ads           | `take_screenshot` with `full_page`, `block`   |
| Save https://example.com/invoice as an A4 PDF to ./invoice.pdf              | `generate_pdf` with `format`, `save_path`     |
| Read https://react.dev/learn and summarize it                               | `scrape_page`                                 |
| Make a 10-second scrolling GIF of https://apple.com                         | `record_scrolling_video`                      |
| Screenshot these 5 competitor homepages                                     | `bulk_screenshots`                            |
| Is bulk job 1f2e... done yet?                                               | `get_bulk_status`                             |

## Tool Reference

All 8 tools wrap the ScreenshotAPI REST API. The render tools (`take_screenshot`, `generate_pdf`, `scrape_page`, `record_scrolling_video`) call `GET https://shot.screenshotapi.net/v3/screenshot` with `output=json` and share the page preparation options below. Each takes either `url` or `custom_html`.

### Shared render options

| Group              | Parameters                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport           | `width` (default 1680, max 7680), `height` (default 876, max 4320)                                                                                 |
| Timing             | `delay`, `wait_for_event` (`load` / `domcontentloaded` / `networkidle`), `lazy_load`, `scroll_delay`, `timeout`                                    |
| Page manipulation  | `css`, `css_url`, `js`, `js_url`, `remove_selector`, `blur_selector`, `selector_to_click`, `click_recursion`, `scroll_to_element`, `adjust_top`    |
| Blocking           | `block` (list: `ads`, `tracking`, `cookie_banners`, `chat_widgets`, `javascript`, `stylesheets`, `images`, `media`, `fonts`, `text_tracks`, `xhr`, `fetch`, `event_source`, `websockets`, `manifest`), `block_specific_requests` |
| Emulation          | `dark_mode`, `grayscale` (0-100), `enable_incognito`, `user_agent`, `accept_languages`, `headers`, `cookies`, `template_id`, `proxy`, `latitude`, `longitude`, `timezone` |
| Caching            | `fresh`, `enable_caching`, `ttl` (screenshot and PDF only)                                                                                          |
| Storage            | `result_file_name`, `byob`, `storage_service`, `bucket_name` (screenshot and PDF only)                                                              |

### take_screenshot

Captures a page as an image and returns the hosted image URL. The image is also returned inline so the assistant can see it. Full-page captures are the exception, since they are usually too tall to view; pass `include_image=true` to get them inline anyway.

| Parameter         | Required | Description                                                                 |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `url`             | One of   | URL to capture                                                              |
| `custom_html`     | One of   | Raw HTML to render instead of a URL                                         |
| `file_type`       | No       | `png` (default), `jpg`, `webp`                                              |
| `full_page`       | No       | Capture the whole scrollable page. Default `false`                          |
| `retina`          | No       | 2x pixel density. Default `false`                                           |
| `image_quality`   | No       | JPEG quality 0-100. Default 80                                              |
| `omit_background` | No       | Transparent background for plain-background pages (PNG only)                |
| `thumbnail_width` | No       | Resize output to this width, keeping aspect ratio                           |
| `selector`        | No       | Capture a single element by CSS selector                                    |
| `clip`            | No       | Capture a rectangle: `{ x, y, width, height }`                              |
| `sizes`           | No       | Capture at several viewport sizes in one request: `[{ width, height }, ...]` |
| `include_image`   | No       | Return the image inline. Default `true`, or `false` when `full_page` is set |
| `save_path`       | No       | Also save the file locally                                                  |

Plus all [shared render options](#shared-render-options).

### generate_pdf

Converts a URL or raw HTML to PDF and returns the hosted PDF URL. With no `format` (and no `width`/`height`), the whole page becomes one continuous PDF page.

| Parameter          | Required | Description                                                                  |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `url`              | One of   | URL to convert                                                               |
| `custom_html`      | One of   | Raw HTML to convert                                                          |
| `format`           | No       | `A0`–`A6`, `Letter`, `Legal`, `Tabloid`, `Ledger`                            |
| `landscape`        | No       | Landscape orientation. Default `false`                                       |
| `page_range`       | No       | Keep only these pages, e.g. `1-3`                                            |
| `print_background` | No       | Include background colors and images                                         |
| `media`            | No       | `print` or `screen` CSS                                                      |
| `save_path`        | No       | Also save the PDF locally                                                    |

Plus all [shared render options](#shared-render-options).

### scrape_page

Renders the page in a real browser, so JavaScript runs first, then extracts its content. The server downloads the extracted files and returns their contents inline. A screenshot is captured in the same request.

| Parameter           | Required | Description                                                         |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `url`               | One of   | URL to scrape                                                       |
| `custom_html`       | One of   | Raw HTML to process                                                 |
| `extract`           | No       | Any of `markdown`, `text`, `html`, `image_urls`. Default `markdown` |
| `include_content`   | No       | Return extracted contents inline. Default `true`                    |
| `max_content_chars` | No       | Truncate each extracted file. Default 50000                         |

Plus viewport, timing, page manipulation, blocking, and emulation options.

### record_scrolling_video

Records the browser scrolling down a page and returns the hosted video URL.

| Parameter           | Required | Description                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------- |
| `url`               | One of   | URL to record                                                             |
| `custom_html`       | One of   | Raw HTML to record                                                        |
| `file_type`         | No       | `mp4` (default), `webm`, `gif`                                            |
| `scroll_speed`      | No       | `slow`, `normal` (default), `fast`                                        |
| `duration`          | No       | Seconds, 0-60                                                             |
| `scroll_back`       | No       | Scroll back to the top at the end                                         |
| `start_immediately` | No       | Start recording before the page finishes loading                          |
| `video`             | No       | Record the viewport for `duration` seconds without scrolling              |
| `sizes`             | No       | Record at several viewport sizes: `[{ width, height }, ...]`, up to 10    |
| `save_path`         | No       | Also save the video locally (single size only)                            |

Plus viewport, timing, page manipulation, blocking, and emulation options.

### bulk_screenshots

`POST https://api.screenshotapi.net/v1/bulk/json` submits up to 50 URLs as one job. Paid plans only.

| Parameter     | Required | Description                                                                                      |
| ------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `screenshots` | Yes      | `[{ url, ...options }]`. Options use raw API names (`file_type`, `width`, `full_page`, `block_ads`, ...) |
| `defaults`    | No       | Options applied to every entry unless the entry overrides them                                   |

### bulk_screenshots_csv

`POST https://api.screenshotapi.net/v1/bulk/csv` uploads a CSV with a `url` column. Any other column is a render option for that row. Paid plans only.

| Parameter     | Required | Description                         |
| ------------- | -------- | ----------------------------------- |
| `csv_path`    | One of   | Path to a local CSV file            |
| `csv_content` | One of   | CSV text                            |

### get_bulk_status

`GET https://api.screenshotapi.net/v1/bulk/csv/status` returns `percent_complete`, `successful_urls`, and `failed_urls` for a job.

| Parameter | Required | Description |
| --------- | -------- | ----------- |
| `uuid`    | Yes      | Job uuid    |

### download_bulk_results

`GET https://api.screenshotapi.net/v1/bulk/csv/download` returns one row per URL with `url`, `status`, `screenshot`, and `error_message`.

| Parameter | Required | Description |
| --------- | -------- | ----------- |
| `uuid`    | Yes      | Job uuid    |

## Prompt Examples

### Screenshots

- Take a screenshot of https://linear.app
- Screenshot https://github.com on a 390px-wide mobile viewport in dark mode.
- Capture the full page of https://vercel.com/pricing with ads and cookie banners blocked.
- Grab just the pricing table on https://example.com/pricing (selector `#pricing`).
- Screenshot our staging site and blur anything with the class `.user-email`.
- Show me how https://www.bbc.com looks from Germany in German.

### PDFs

- Convert https://example.com/report to an A4 landscape PDF and save it to ./report.pdf.
- Turn this HTML invoice into a Letter-size PDF.
- Export only pages 2-4 of https://docs.example.com/guide as a PDF.

### Scraping

- Read https://react.dev/learn and give me the key points.
- Get the rendered HTML of https://example.com after JavaScript runs.
- List every image URL on https://unsplash.com.

### Video

- Record a slow scrolling MP4 of https://stripe.com that scrolls back to the top.
- Make a scrolling GIF of our landing page at desktop and mobile sizes.

### Bulk

- Screenshot these 20 URLs at 1440x900 with cookie banners hidden.
- What's the status of my bulk job, and download the results when it's done.

## Error Codes

Tool calls never crash the server. Upstream errors come back as structured tool results with `error`, `code`, `message`, and a `guidance` field, so the client can explain the problem and suggest a fix.

| Code      | Meaning                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `310`     | Too many redirects on the target URL                                                                        |
| `400`     | Invalid parameters (URL, file type, proxy, geolocation, CSS/JS URL, clip, template) or target SSL problems |
| `401`     | Missing or invalid `SCREENSHOTAPI_TOKEN`, or inactive subscription                                          |
| `402`     | Service paused for unpaid dues or usage over twice the plan quota                                           |
| `403`     | Screenshot quota used up, trial expired, or target refused the connection                                   |
| `404`     | Account is not on a plan or trial                                                                           |
| `407`     | Proxy tunnel connection failed                                                                              |
| `408`     | Page took too long to render                                                                                |
| `429`     | Too many requests per minute                                                                                |
| `444`     | Target site closed the connection or returned nothing                                                       |
| `495`     | Target site SSL/TLS version or cipher mismatch                                                              |
| `499`     | This server stopped waiting for the API (see `SCREENSHOTAPI_REQUEST_TIMEOUT_MS`)                            |
| `500`     | ScreenshotAPI internal error, safe to retry                                                                 |
| `502`     | Server could not reach ScreenshotAPI                                                                        |
| `503`     | ScreenshotAPI or the target page is temporarily unavailable                                                 |

Example error result for a missing URL:

```json
{
  "error": "url_required",
  "code": 400,
  "message": "Provide either 'url' or 'custom_html'.",
  "guidance": "Pass a fully qualified URL including the protocol, e.g. 'https://example.com', or pass custom_html instead."
}
```

See the full list in the [ScreenshotAPI error docs](https://www.screenshotapi.net/docs/errors).

## How It Works

This is a stdio MCP server that wraps the ScreenshotAPI REST API.

At runtime:

1. Your MCP client starts the server process via `npx`.
2. The client reads the tool list.
3. When a prompt matches a tool, the client calls it.
4. The server validates inputs, calls ScreenshotAPI with `output=json`, and returns structured JSON with the hosted file URL.
5. For screenshots, the server also downloads the image and returns it inline. For scraping, it downloads the extracted Markdown, text, or HTML and returns the contents.

The API key is read from the environment on each call and sent as the `token` parameter. The server strips the token from every response before it reaches the model. Requests with very long values, such as large `custom_html`, are sent as a POST with a JSON body to avoid URL length limits.

## Environment Variables

| Variable                               | Required | Default   | Description                                         |
| -------------------------------------- | -------- | --------- | --------------------------------------------------- |
| `SCREENSHOTAPI_TOKEN`                  | Yes      |           | Your ScreenshotAPI API key                          |
| `SCREENSHOTAPI_REQUEST_TIMEOUT_MS`     | No       | `180000`  | Upstream request timeout in ms                      |
| `SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES` | No       | `3500000` | Largest screenshot returned inline to the model     |

## Building from Source

```bash
git clone https://github.com/Screenshot-API/screenshot-mcp.git
cd screenshot-mcp
npm install
npm run build
```

Run it directly:

```bash
SCREENSHOTAPI_TOKEN=<YOUR_KEY> node dist/cli.js
```

Inspect with the MCP Inspector:

```bash
SCREENSHOTAPI_TOKEN=<YOUR_KEY> npx @modelcontextprotocol/inspector node dist/cli.js
```

## Troubleshooting

**Client uses an old tool list after updating:** Restart the client and confirm it loaded the latest npm version.

**401 `token_required`:** `SCREENSHOTAPI_TOKEN` is not set in your MCP client config's `env` block.

**401 `invalid_token`:** The key is wrong, or it was rolled in the dashboard. Copy the current key from the [dashboard](https://app.screenshotapi.net).

**Screenshot comes back as a URL but not an image:** The image is larger than `SCREENSHOTAPI_MAX_INLINE_IMAGE_BYTES`, or it was a `full_page` capture. Use `thumbnail_width`, `jpg` with a lower `image_quality`, or set `include_image=true`.

**Blank or half-loaded pages:** Add `delay` (e.g. 3000), use `wait_for_event=networkidle`, or set `lazy_load=true` for pages with lazy images.

**Cookie banners or popups in the shot:** Pass `block: ["cookie_banners", "ads", "chat_widgets"]`, or remove specific elements with `remove_selector`.

**CAPTCHA or bot blocks:** Route the request through a residential `proxy`. See the [proxy docs](https://www.screenshotapi.net/docs/proxy).

**Timeouts:** Slow pages may need a higher `timeout` (API side, default 100000 ms) and a higher `SCREENSHOTAPI_REQUEST_TIMEOUT_MS` (this server, default 180000 ms). Some MCP clients also have their own tool-call timeout.

## Links

- [ScreenshotAPI Website](https://www.screenshotapi.net)
- [API Documentation](https://www.screenshotapi.net/docs/getStarted)
- [Query Builder](https://app.screenshotapi.net)
- [Pricing](https://www.screenshotapi.net/pricing)
- [GitHub Repository](https://github.com/Screenshot-API/screenshot-mcp)

## License

[MIT](LICENSE)
