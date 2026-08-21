/**
 * dsh-custom-theme host half.
 *
 * Serves the configured artwork from a webserver route, injects the package
 * stylesheet into every web index response, and exposes a small JSON API so
 * the browser Settings tab can edit the theme config, upload a background
 * image, and trigger an agent-driven palette analysis. The browser half
 * (`./client`) owns the dark-mode toggle and the Settings page.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import type { Palette } from './types.ts'
import { analyzeImage } from './analyze-image.ts'

export const name = 'dsh-custom-theme'
export const inject = ['webServer']

export interface Config {
  /** Absolute pathname prefix served by the image route. */
  imageRoute: string
  /** Absolute pathname of the image requested by the injected CSS. */
  imagePath: string
  /** Uploaded image file name (data dir) or package-relative default asset. */
  imageFile: string
  /** Light-mode backdrop overlay color. */
  overlayLight: string
  /** Dark-mode backdrop overlay color. */
  overlayDark: string
  /** Agent-derived palette overrides for light mode. */
  paletteLight?: Palette
  /** Agent-derived palette overrides for dark mode. */
  paletteDark?: Palette
  /** Epoch ms of the last successful agent analysis. */
  analyzedAt?: number
  /** Short rationale recorded by the agent with the palette. */
  analysisNote?: string
  /** Explicit provider route for the palette analysis model. */
  analyzeProvider?: string
  /** Explicit model id for the palette analysis (paired with analyzeProvider). */
  analyzeModel?: string
}

const absolutePath = z.string()
  .pattern(/^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]|%[0-9A-Fa-f]{2})*$/)
  .pattern(/^(?!.*(?:^|\/)\.\.(?:\/|$))/)

const paletteEntry = z.object({
  bgBase: z.string(),
  layer1: z.string(),
  layer2: z.string(),
  layer3: z.string(),
  border: z.string(),
  labelPrimary: z.string(),
  labelSecondary: z.string(),
  brand: z.string(),
})

export const Config = z.object({
  imageRoute: absolutePath.pattern(/[^/]$/).default('/custom-theme'),
  imagePath: absolutePath.default('/custom-theme/theme.jpg'),
  imageFile: z.string()
    .pattern(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-\/]+$/)
    .default('assets/theme.jpg'),
  overlayLight: z.string().default('rgba(255, 255, 255, 0.04)'),
  overlayDark: z.string().default('rgba(10, 12, 8, 0.34)'),
  paletteLight: paletteEntry,
  paletteDark: paletteEntry,
  analyzedAt: z.number(),
  analysisNote: z.string(),
  analyzeProvider: z.string(),
  analyzeModel: z.string(),
})

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** CSS declarations bridging one palette mode into `:root` variables. */
function paletteVars(palette: Palette | undefined, mode: 'light' | 'dark'): string[] {
  if (!palette) return []
  const map: Array<[keyof Palette, string]> = [
    ['bgBase', 'bg-base'],
    ['layer1', 'layer1'],
    ['layer2', 'layer2'],
    ['layer3', 'layer3'],
    ['border', 'border'],
    ['labelPrimary', 'label-primary'],
    ['labelSecondary', 'label-secondary'],
    ['brand', 'brand'],
  ]
  const lines: string[] = []
  for (const [key, suffix] of map) {
    const value = palette[key]
    if (value !== undefined && value !== '') {
      lines.push(`  --dsh-custom-theme-${mode}-${suffix}: ${escapeCssString(value)};`)
    }
  }
  return lines
}

function configBridgeScript(config: Config): string {
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c')
  return `<script>window.__DSH_CUSTOM_THEME_CONFIG__ = ${configJson}<\/script>`
}

function injectStyles(html: string, css: string, config: Config): string {
  const palette = [
    ...paletteVars(config.paletteLight, 'light'),
    ...paletteVars(config.paletteDark, 'dark'),
  ]
  const overlay = `${configBridgeScript(config)}<style data-dsh-custom-theme-config>${[
    ':root {',
    `  --dsh-custom-theme-image: url("${escapeCssString(config.imagePath)}");`,
    `  --dsh-custom-theme-overlay-light: ${config.overlayLight};`,
    `  --dsh-custom-theme-overlay-dark: ${config.overlayDark};`,
    ...palette,
    '}',
  ].join('\n')}</style>`
  const theme = `<style data-dsh-custom-theme>${css}</style>`
  const tag = `${overlay}${theme}`
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${html}\n${tag}`
}

/** User data directory next to the persisted config file. */
function dataDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-custom-theme')
}

function stateFilePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-custom-theme.config.json')
}

function loadPersistedConfig(base: Config): Config {
  try {
    const raw = readFileSync(stateFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Config>
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null && value !== undefined) clean[key] = value
    }
    return Config({ ...base, ...clean })
  } catch {
    return base
  }
}

function writePersistedConfig(config: Config): void {
  writeFileSync(stateFilePath(), JSON.stringify(config, null, 2), 'utf8')
}

/** Resolve a package-relative asset from either the built lib/ or the source tree. */
function resolveAsset(configFile: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const built = resolve(here, configFile)
  if (existsSync(built)) return built
  // Source launch: `lib/index.js` is not emitted yet, so fall back to src/.
  return resolve(here, '../src', configFile)
}

/** Resolve the current background image file: uploaded data-dir file first, package asset otherwise. */
function resolveImageFile(config: Config): string {
  const uploaded = join(dataDir(), config.imageFile)
  if (existsSync(uploaded)) return uploaded
  return resolveAsset(config.imageFile)
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}

function sendJson(res: { writeHead(code: number, headers: Record<string, string>): unknown; end(body: string): unknown }, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function sendError(res: { writeHead(code: number, headers: Record<string, string>): unknown; end(body: string): unknown }, code: number, message: string): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: message }))
}

function readBody(req: { on(event: 'data', cb: (chunk: Buffer) => void): unknown; on(event: 'end', cb: () => void): unknown; headers?: Record<string, string | string[] | undefined> }): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers?.['content-length'] ?? 0)
    if (declared > MAX_UPLOAD_BYTES) {
      reject(new Error(`payload too large (limit ${MAX_UPLOAD_BYTES} bytes)`))
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_UPLOAD_BYTES) {
        reject(new Error(`payload too large (limit ${MAX_UPLOAD_BYTES} bytes)`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
  })
}

export function apply(ctx: Context, config: Config): void {
  let currentConfig = loadPersistedConfig(config)
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles', 'theme.css'), 'utf8')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/custom-theme',
    handler(req, res) {
      const pathname = new URL(req.url ?? '/', 'http://dsh').pathname
      if (pathname !== currentConfig.imagePath) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const file = resolveImageFile(currentConfig)
        const body = readFileSync(file)
        res.writeHead(200, {
          'content-type': contentTypeFor(file),
          'cache-control': 'public, max-age=86400',
        })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-custom-theme: image route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/custom-theme-config',
    async handler(req, res) {
      if (req.method === 'GET') {
        sendJson(res, { ok: true, config: currentConfig })
        return
      }
      if (req.method !== 'POST') {
        sendError(res, 405, 'method not allowed')
        return
      }
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8')) as Partial<Config>
        const next = Config({ ...currentConfig, ...body })
        currentConfig = next
        writePersistedConfig(next)
        sendJson(res, { ok: true, config: next })
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : String(error))
      }
    },
  }), 'dsh-custom-theme: config API')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/custom-theme/upload',
    async handler(req, res) {
      if (req.method !== 'POST') {
        sendError(res, 405, 'method not allowed')
        return
      }
      try {
        const declaredType = String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase()
        if (!IMAGE_CONTENT_TYPES.has(declaredType)) {
          sendError(res, 415, `unsupported content-type "${declaredType}"; send image/jpeg, image/png, image/webp or image/gif`)
          return
        }
        const body = await readBody(req)
        if (body.length === 0) {
          sendError(res, 400, 'empty upload body')
          return
        }
        const ext = declaredType === 'image/jpeg' ? '.jpg' : declaredType === 'image/png' ? '.png' : declaredType === 'image/webp' ? '.webp' : '.gif'
        mkdirSync(dataDir(), { recursive: true })
        const fileName = `upload-${Date.now()}${ext}`
        writeFileSync(join(dataDir(), fileName), body)
        const next = Config({
          ...currentConfig,
          imageFile: fileName,
          imagePath: `${currentConfig.imageRoute}/${fileName}`,
        })
        currentConfig = next
        writePersistedConfig(next)
        sendJson(res, { ok: true, config: next })
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : String(error))
      }
    },
  }), 'dsh-custom-theme: upload API')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/custom-theme/analyze',
    async handler(req, res) {
      if (req.method !== 'POST') {
        sendError(res, 405, 'method not allowed')
        return
      }
      try {
        const imageFile = resolveImageFile(currentConfig)
        const result = analyzeImage(imageFile)
        const next = Config({
          ...currentConfig,
          paletteLight: result.light,
          paletteDark: result.dark,
          overlayLight: result.light.overlay ?? currentConfig.overlayLight,
          overlayDark: result.dark.overlay ?? currentConfig.overlayDark,
          analyzedAt: Date.now(),
          analysisNote: result.rationale,
        })
        currentConfig = next
        writePersistedConfig(next)
        sendJson(res, { ok: true, config: next })
      } catch (error) {
        sendError(res, 502, error instanceof Error ? error.message : String(error))
      }
    },
  }), 'dsh-custom-theme: analyze API')

  ctx.effect(() => ctx.webServer.tapIndex(html => injectStyles(html, css, currentConfig)), 'dsh-custom-theme: inject theme styles')
}

