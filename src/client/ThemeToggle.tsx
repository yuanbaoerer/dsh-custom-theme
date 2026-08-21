import { useSyncExternalStore } from 'react'
import { IconDarkOutline16, IconLightOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ThemeToggle.module.css'
import { NS } from './locales.ts'

export interface ThemeToggleInjected {
  /** Switch to a registered theme id; `light` and `dark` are built in. */
  setTheme: (id: string) => void
  /** React external-store subscription owned by the plugin fiber. */
  subscribe: (listener: () => void) => () => void
  /** Read the resolved dark/light state owned by the plugin fiber. */
  getSnapshot: () => boolean
}

export type ThemeToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<ThemeToggleInjected>

export function ThemeToggle({ setTheme, subscribe, getSnapshot, t }: ThemeToggleProps) {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const next = dark ? 'light' : 'dark'
  const label = dark ? t('toggle.toLight') : t('toggle.toDark')
  return (
    <button
      type="button"
      className={css.toggle}
      aria-label={label}
      title={label}
      onClick={() => { setTheme(next) }}
    >
      {dark ? <IconLightOutline16 size={16} /> : <IconDarkOutline16 size={16} />}
    </button>
  )
}
