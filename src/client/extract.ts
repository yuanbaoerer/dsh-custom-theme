/**
 * Deterministic, model-free palette extraction for dsh-custom-theme.
 *
 * Runs entirely in the browser: the current background image is drawn to a
 * canvas (same-origin, so the canvas is never tainted), sampled down to a
 * small grid, quantized into dominant colors, and turned into a two-mode
 * palette that mirrors the model contract in `agent.ts`. This guarantees the
 * "match the artwork" feature works even when no vision-capable model is
 * configured; the model-driven analysis remains available for smarter results.
 */
import type { PaletteMode } from '../types.ts'

interface Rgb { r: number; g: number; b: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function toHex(color: Rgb): string {
  const pad = (value: number) => clamp(value, 0, 255).toString(16).padStart(2, '0')
  return `#${pad(color.r)}${pad(color.g)}${pad(color.b)}`
}

function luminance(color: Rgb): number {
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255
}

function saturation(color: Rgb): number {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  return max === 0 ? 0 : (max - min) / max
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

/** Sample the image into a 48x48 grid and collect dominant color buckets. */
function dominantColors(image: HTMLImageElement): Rgb[] {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas 2d context unavailable')
  context.drawImage(image, 0, 0, size, size)
  const data = context.getImageData(0, 0, size, size).data

  const buckets = new Map<number, { count: number; sum: Rgb }>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 40) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // 8-step quantization keeps the map small while preserving hue families.
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

  const average = (colors: Rgb[]): Rgb => {
    const sum = colors.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), { r: 0, g: 0, b: 0 })
    return { r: sum.r / colors.length, g: sum.g / colors.length, b: sum.b / colors.length }
  }

  if (ranked.length === 0) return [{ r: 120, g: 120, b: 120 }]
  const primary = ranked[0].color
  const secondary = ranked.length > 1 ? ranked[1].color : primary
  // The accent is the most saturated dominant color, so the brand reads as art-driven.
  const accent = [...ranked].sort((a, b) => saturation(b.color) - saturation(a.color))[0].color
  const background = luminance(primary) > 0.55 ? average([primary, secondary]) : primary
  return [background, accent, secondary]
}

/** Derive light + dark palettes from the sampled dominant colors. */
export function buildPalettes(image: HTMLImageElement): { light: PaletteMode; dark: PaletteMode } {
  const [base, accent, secondary] = dominantColors(image)
  const baseIsLight = luminance(base) > 0.5
  const accentIsLight = luminance(accent) > 0.55

  const light: PaletteMode = {
    bgBase: rgba(baseIsLight ? mix(base, { r: 255, g: 255, b: 255 }, 0.82) : mix(base, { r: 255, g: 255, b: 255 }, 0.88), 0.55),
    layer1: rgba(mix(base, { r: 255, g: 255, b: 255 }, 0.94), 0.62),
    layer2: rgba(mix(base, { r: 255, g: 255, b: 255 }, 0.92), 0.74),
    layer3: rgba(mix(base, { r: 255, g: 255, b: 255 }, 0.90), 0.86),
    border: rgba(mix(accent, { r: 255, g: 255, b: 255 }, 0.6), 0.22),
    labelPrimary: '#262620',
    labelSecondary: '#5d5d52',
    brand: accentIsLight ? toHex(mix(accent, { r: 40, g: 40, b: 30 }, 0.4)) : toHex(mix(accent, { r: 128, g: 128, b: 128 }, 0.22)),
    overlay: 'rgba(255, 255, 255, 0.05)',
  }

  const dark: PaletteMode = {
    bgBase: rgba(baseIsLight ? mix(base, { r: 10, g: 12, b: 10 }, 0.82) : mix(base, { r: 8, g: 10, b: 8 }, 0.62), 0.58),
    layer1: rgba(mix(base, { r: 20, g: 22, b: 18 }, 0.75), 0.66),
    layer2: rgba(mix(base, { r: 24, g: 26, b: 22 }, 0.72), 0.76),
    layer3: rgba(mix(base, { r: 30, g: 32, b: 27 }, 0.7), 0.85),
    border: rgba(mix(accent, { r: 235, g: 240, b: 225 }, 0.55), 0.16),
    labelPrimary: '#ecece4',
    labelSecondary: '#a9a99c',
    brand: accentIsLight ? toHex(mix(accent, { r: 20, g: 22, b: 18 }, 0.35)) : toHex(mix(accent, { r: 128, g: 128, b: 128 }, 0.28)),
    overlay: 'rgba(8, 10, 8, 0.35)',
  }

  // Keep the dark accent distinct from the dark surfaces.
  if (saturation(hexToRgb(dark.brand ?? '#888888')) < 0.15) {
    dark.brand = toHex(mix(secondary, { r: 255, g: 255, b: 255 }, 0.25))
  }
  return { light, dark }
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value
  const parsed = Number.parseInt(full, 16)
  return { r: (parsed >> 16) & 0xff, g: (parsed >> 8) & 0xff, b: parsed & 0xff }
}

/** Load the current background image and build the palette from it. */
export async function extractPaletteFromImage(src: string): Promise<{ light: PaletteMode; dark: PaletteMode }> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolvePromise, reject) => {
    image.onload = () => resolvePromise()
    image.onerror = () => reject(new Error(`无法加载背景图: ${src}`))
    image.src = src
  })
  return buildPalettes(image)
}
