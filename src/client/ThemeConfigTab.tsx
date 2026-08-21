import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './ThemeConfigTab.module.css'
import { extractPaletteFromImage } from './extract.ts'
import { NS } from './locales.ts'

/** One mode's tunable palette (mirrors the host-side Palette). */
export interface PaletteView {
  bgBase?: string
  layer1?: string
  layer2?: string
  layer3?: string
  border?: string
  labelPrimary?: string
  labelSecondary?: string
  brand?: string
}

/** Editable projection of the host-side theme configuration. */
export interface ThemeConfigView {
  imageRoute: string
  imagePath: string
  imageFile: string
  overlayLight: string
  overlayDark: string
  paletteLight?: PaletteView
  paletteDark?: PaletteView
  analyzedAt?: number
  analysisNote?: string
}

export interface ThemeConfigTabInjected {
  config: ThemeConfigView
}

export type ThemeConfigTabProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<ThemeConfigTabInjected>

const DEFAULT_CONFIG: ThemeConfigView = {
  imageRoute: '/custom-theme',
  imagePath: '/custom-theme/theme.jpg',
  imageFile: 'assets/theme.jpg',
  overlayLight: 'rgba(255, 255, 255, 0.04)',
  overlayDark: 'rgba(10, 12, 8, 0.34)',
}

/** Read the config snapshot injected by the host half. */
export function readThemeConfig(): ThemeConfigView {
  const value = (globalThis as { __DSH_CUSTOM_THEME_CONFIG__?: Partial<ThemeConfigView> }).__DSH_CUSTOM_THEME_CONFIG__
  if (!value || typeof value !== 'object') return DEFAULT_CONFIG
  return { ...DEFAULT_CONFIG, ...value }
}

async function requestJson(url: string, init?: RequestInit): Promise<ThemeConfigView> {
  const response = await fetch(url, init)
  const body = await response.json() as { ok: boolean; config?: ThemeConfigView; error?: string }
  if (!response.ok || !body.ok || !body.config) {
    throw new Error(body.error ?? 'request failed')
  }
  return body.config
}

/** Apply a config to the document root so changes take effect without a reload. */
export function applyConfigLive(config: ThemeConfigView): void {
  const root = document.documentElement
  const set = (name: string, value: string | undefined) => {
    if (value === undefined || value === '') root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  set('--dsh-custom-theme-image', `url("${config.imagePath}")`)
  set('--dsh-custom-theme-overlay-light', config.overlayLight)
  set('--dsh-custom-theme-overlay-dark', config.overlayDark)
  const applyPalette = (palette: PaletteView | undefined, mode: 'light' | 'dark') => {
    if (!palette) return
    const map: Array<[keyof PaletteView, string]> = [
      ['bgBase', 'bg-base'],
      ['layer1', 'layer1'],
      ['layer2', 'layer2'],
      ['layer3', 'layer3'],
      ['border', 'border'],
      ['labelPrimary', 'label-primary'],
      ['labelSecondary', 'label-secondary'],
      ['brand', 'brand'],
    ]
    for (const [key, suffix] of map) set(`--dsh-custom-theme-${mode}-${suffix}`, palette[key])
  }
  applyPalette(config.paletteLight, 'light')
  applyPalette(config.paletteDark, 'dark')
}

function formatTime(epochMs: number | undefined, neverLabel: string): string {
  if (!epochMs) return neverLabel
  return new Date(epochMs).toLocaleString()
}

export function ThemeConfigTab({ t, config }: ThemeConfigTabProps) {
  const [current, setCurrent] = useState<ThemeConfigView>(config)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = (next: ThemeConfigView) => {
    setCurrent(next)
    applyConfigLive(next)
    // The config bridge (injected at page load) keeps the previously injected
    // palette/image vars, and inline overrides cannot clear them. Reload so
    // the bridge re-injects the freshly saved config (this also restores a
    // cleared palette to the shipped defaults).
    window.setTimeout(() => window.location.reload(), 250)
  }

  const run = async (op: string, fn: () => Promise<ThemeConfigView>, okText: string) => {
    setBusy(op)
    setMessage(null)
    try {
      const next = await fn()
      apply(next)
      setMessage({ text: okText, error: false })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true })
    } finally {
      setBusy(null)
    }
  }

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await run('upload', async () => {
      return await requestJson('/custom-theme/upload', {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      })
    }, t('uploadSuccess'))
    if (fileRef.current) fileRef.current.value = ''
  }

  const analyze = () => {
    void run('analyze', async () => {
      return await requestJson('/custom-theme/analyze', { method: 'POST' })
    }, t('aiSuccess'))
  }

  const extractLocal = () => {
    void run('extract', async () => {
      const palette = await extractPaletteFromImage(current.imagePath)
      return await requestJson('/custom-theme-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paletteLight: palette.light,
          paletteDark: palette.dark,
          overlayLight: palette.light.overlay,
          overlayDark: palette.dark.overlay,
        }),
      })
    }, t('extractSuccess'))
  }

  const reset = () => {
    void run('reset', async () => {
      return await requestJson('/custom-theme-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Empty palettes fall back to the shipped olive/paper palette; this
        // fully restores the original default theme (artwork + palette).
        body: JSON.stringify({ ...DEFAULT_CONFIG, paletteLight: {}, paletteDark: {} }),
      })
    }, t('resetSuccess'))
  }

  const swatches: Array<[string, string | undefined]> = [
    [t('lightMode'), current.paletteLight?.brand],
    [t('darkMode'), current.paletteDark?.brand],
  ]

  return (
    <div className={css.panel}>
      <h3 className={css.title}>{t('configTitle')}</h3>

      <div className={css.previewWrap}>
        <img className={css.preview} src={current.imagePath} alt={t('preview')} />
        <span className={css.fileName}>{current.imageFile}</span>
      </div>

      <div className={css.actions}>
        <button
          type="button"
          className={css.action}
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === 'upload' ? t('uploading') : t('chooseFile')}
        </button>
        <button
          type="button"
          className={css.actionPrimary}
          onClick={extractLocal}
          disabled={busy !== null}
        >
          {busy === 'extract' ? t('extracting') : t('extract')}
        </button>
        <button
          type="button"
          className={css.action}
          onClick={analyze}
          disabled={busy !== null}
        >
          {busy === 'analyze' ? t('aiAnalyzing') : t('aiAnalyze')}
        </button>
        <button
          type="button"
          className={css.actionGhost}
          onClick={reset}
          disabled={busy !== null}
        >
          {busy === 'reset' ? t('resetting') : t('reset')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className={css.hiddenFile}
          onChange={(event) => { void onFileChange(event) }}
        />
      </div>

      {message && (
        <div className={message.error ? css.error : css.message}>{message.text}</div>
      )}
      <div className={css.hint}>{t('applyHint')}</div>
      <div className={css.hint}>{t('aiNeedsVision')}</div>

      <div className={css.meta}>
        <div className={css.metaRow}>
          <span className={css.metaLabel}>{t('analyzedAt')}</span>
          <span className={css.metaValue}>{formatTime(current.analyzedAt, t('never'))}</span>
        </div>
        {current.analysisNote && (
          <div className={css.metaRow}>
            <span className={css.metaLabel}>{t('analysisNote')}</span>
            <span className={css.metaValue}>{current.analysisNote}</span>
          </div>
        )}
        {swatches.some(([, value]) => value) && (
          <div className={css.metaRow}>
            <span className={css.metaLabel}>{t('palette')}</span>
            <span className={css.swatches}>
              {swatches.map(([label, value]) => value && (
                <span key={label} className={css.swatch} title={`${label}: ${value}`}>
                  <span className={css.swatchDot} style={{ background: value }} />
                  {label}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
