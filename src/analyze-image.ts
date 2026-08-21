/**
 * Deterministic, model-free palette analysis for dsh-custom-theme (server side).
 *
 * Decodes the background image with ffmpeg (same tool the original theme used)
 * to raw RGB pixels, quantizes them into dominant colors, and derives a
 * two-mode palette plus overlay transparency from color theory. This is the
 * guaranteed-to-work path: it needs no vision model and no agent toolset.
 */
import { execFileSync } from 'node:child_process'
import type { PaletteAnalysis } from './types.ts'

interface Rgb { r: number; g: number; b: number }

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function toHex(color: Rgb): string {
  const pad = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
  return `#${pad(color.r)}${pad(color.g)}${pad(color.b)}`
}

const luminance = (color: Rgb): number => (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255

const saturation = (color: Rgb): number => {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  return max === 0 ? 0 : (max - min) / max
}

const rgba = (color: Rgb, alpha: number): string => `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value
  const parsed = Number.parseInt(full, 16)
  return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff }
}

/** Decode the image to a W×H raw RGB buffer using ffmpeg. */
function decodeRgb(imagePath: string, width: number, height: number): Buffer {
  return execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-i', imagePath, '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { maxBuffer: 16 * 1024 * 1024 },
  )
}

/** Quantize RGB samples into dominant-color buckets and return the top colors. */
function dominantColors(rgb: Buffer): Rgb[] {
  const buckets = new Map<number, { count: number; sum: Rgb }>()
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const r = rgb[i]
    const g = rgb[i + 1]
    const b = rgb[i + 2]
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5)
    const entry = buckets.get(key)
    if (entry) {
      entry.count++
      entry.sum.r += r
      entry.sum.g += g
      entry.sum.b += b
    } else {
      buckets.set(key, { count: 1, sum: { r, g, b } })
    }
  }
  const ranked = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([, entry]) => ({
      color: { r: entry.sum.r / entry.count, g: entry.sum.g / entry.count, b: entry.sum.b / entry.count },
      count: entry.count,
    }))
  if (ranked.length === 0) return [{ r: 120, g: 120, b: 120 }]
  const primary = ranked[0].color
  const secondary = ranked.length > 1 ? ranked[1].color : primary
  const accent = [...ranked].sort((a, b) => saturation(b.color) - saturation(a.color))[0].color
  const base = luminance(primary) > 0.55 ? { r: (primary.r + secondary.r) / 2, g: (primary.g + secondary.g) / 2, b: (primary.b + secondary.b) / 2 } : primary
  return [base, accent, secondary]
}

function buildPalettes(base: Rgb, accent: Rgb, secondary: Rgb): { light: PaletteAnalysis['light']; dark: PaletteAnalysis['dark'] } {
  const baseIsLight = luminance(base) > 0.5
  const accentIsLight = luminance(accent) > 0.55
  const white: Rgb = { r: 255, g: 255, b: 255 }
  const black: Rgb = { r: 10, g: 12, b: 10 }
  const nearWhite: Rgb = { r: 20, g: 22, b: 18 }
  const nearBlack: Rgb = { r: 8, g: 10, b: 8 }
  const warmLight = { r: 40, g: 40, b: 30 }
  const warmDark = { r: 20, g: 22, b: 18 }
  // Neutral gray used to soften an over-saturated accent into a usable UI color.
  const gray = { r: 128, g: 128, b: 128 }

  // bgBase doubles as the translucent surface base (--dsw-alias-bg-base) AND
  // the body backdrop; it MUST stay translucent (rgba) so the artwork shows
  // through the UI surfaces. layer1-3 are translucent too.
  const light: PaletteAnalysis['light'] = {
    bgBase: rgba(baseIsLight ? mix(base, white, 0.82) : mix(base, white, 0.88), 0.55),
    layer1: rgba(mix(base, white, 0.94), 0.62),
    layer2: rgba(mix(base, white, 0.92), 0.74),
    layer3: rgba(mix(base, white, 0.90), 0.86),
    border: rgba(mix(accent, white, 0.6), 0.22),
    labelPrimary: '#262620',
    labelSecondary: '#5d5d52',
    brand: accentIsLight ? toHex(mix(accent, warmLight, 0.4)) : toHex(mix(accent, gray, 0.22)),
    overlay: 'rgba(255, 255, 255, 0.05)',
  }

  const dark: PaletteAnalysis['dark'] = {
    bgBase: rgba(baseIsLight ? mix(base, black, 0.82) : mix(base, nearBlack, 0.62), 0.58),
    layer1: rgba(mix(base, nearWhite, 0.75), 0.66),
    layer2: rgba(mix(base, nearWhite, 0.72), 0.76),
    layer3: rgba(mix(base, nearWhite, 0.70), 0.85),
    border: rgba(mix(accent, { r: 235, g: 240, b: 225 }, 0.55), 0.16),
    labelPrimary: '#ecece4',
    labelSecondary: '#a9a99c',
    brand: accentIsLight ? toHex(mix(accent, warmDark, 0.35)) : toHex(mix(accent, gray, 0.28)),
    overlay: 'rgba(8, 10, 8, 0.35)',
  }
  if (saturation(hexToRgb(dark.brand ?? '#888888')) < 0.15) {
    dark.brand = toHex(mix(secondary, white, 0.25))
  }
  return { light, dark }
}

/** Analyze a background image and produce a two-mode palette. */
export function analyzeImage(imagePath: string): PaletteAnalysis {
  const rgb = decodeRgb(imagePath, 100, 100)
  const [base, accent, secondary] = dominantColors(rgb)
  const { light, dark } = buildPalettes(base, accent, secondary)
  const note = `基于图片主色 ${toHex(base)} 与强调色 ${toHex(accent)} 生成`
  return { light, dark, rationale: note }
}

