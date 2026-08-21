# dsh-custom-theme

An image-based theme bundle for the DeepSeek Harness web GUI. It uses your artwork as the app background, derives a matching two-mode (light/dark) palette, and keeps the surfaces slightly translucent so the artwork shows through.

## Features

- **Artwork background** — set any image as the app backdrop (served from `/custom-theme`).
- **Two-mode palette** — translucent light/dark palettes whose surfaces let the artwork show through.
- **Settings panel** — Settings → 主题配置 (a native settings section) lets you:
  - preview the current background image;
  - upload a new background image (applies immediately, no refresh);
  - **local extract** — sample the image in the browser and generate a palette;
  - **AI palette** — analyze the image server-side (ffmpeg + dominant-color extraction) and generate a palette;
  - reset to the default palette.
- **Native dark-mode toggle** — registered in the conversation header utilities slot, next to Session log.
- **Persistent config** — stored at `~/.dsh/dsh-custom-theme.config.json`.

## Install

```bash
dsh plugin --profile web add github:yuanbaoerer/dsh-custom-theme
dsh web
```

Then open **Settings → 主题配置** to change the background or regenerate the palette.

## Config

| Field | Default | Purpose |
|---|---|---|
| `imageRoute` | `/custom-theme` | route prefix serving the image |
| `imagePath` | `/custom-theme/theme.jpg` | image URL used by CSS |
| `imageFile` | `assets/theme.jpg` | default package asset (uploads live in the data dir) |
| `overlayLight` | `rgba(255, 255, 255, 0.04)` | light backdrop overlay |
| `overlayDark` | `rgba(10, 12, 8, 0.34)` | dark backdrop overlay |
| `analyzeProvider` | _(default model)_ | provider for the AI palette (optional) |
| `analyzeModel` | _(default model)_ | model for the AI palette (optional) |

## Development

```bash
npm install
npm run build   # tsdown + tsc types → lib/
```

The plugin registers into the `settings.section` and `conversation.session.header.utilities` slots via the client half (`src/client`). The host half (`src/index.ts`) serves the image, exposes the config/upload/analyze routes, and injects the palette.

## License

MIT
