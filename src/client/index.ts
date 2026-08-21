/**
 * dsh-custom-theme browser half.
 *
 * Owns the native dark-mode toggle and registers it in the session header
 * utilities slot — the same additive seat used by Session log. The toggle
 * writes through ctx.theme.setTheme, so the durable preference and every
 * theme subscriber stay authoritative.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { NS, en, zh, type ThemeToggleKey } from './locales.ts'
import { ThemeToggle, type ThemeToggleInjected } from './ThemeToggle.tsx'
import { ThemeConfigTab, readThemeConfig, type ThemeConfigTabInjected } from './ThemeConfigTab.tsx'

export type { ThemeToggleInjected, ThemeToggleProps } from './ThemeToggle.tsx'
export type { ThemeConfigTabInjected, ThemeConfigTabProps, ThemeConfigView } from './ThemeConfigTab.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'theme-toggle': ThemeToggleKey
  }
}

export const inject = ['slots', 'theme', 'locale']

/**
 * Register the header toggle. All theme state lives in this plugin fiber:
 * slot renderers subscribe to it and stop cleanly when this entry unloads.
 */
export function apply(ctx: ClientContext): void {
  let dark = ctx.theme.getTheme().active.colorScheme === 'dark'
  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const getSnapshot = (): boolean => dark

  const update = (snapshot: ThemeSnapshot): void => {
    const next = snapshot.active.colorScheme === 'dark'
    if (next === dark) return
    dark = next
    for (const listener of listeners) listener()
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-custom-theme: locale')
  ctx.on('theme/change', update)
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-custom-theme-toggle',
    order: 10,
    locale: NS,
    inject: (): ThemeToggleInjected => ({
      setTheme: (id) => { ctx.theme.setTheme(id) },
      subscribe,
      getSnapshot,
    }),
  }, ThemeToggle))

  // Theme config as its own Settings sidebar section (alongside General,
  // Models, Plugins, Agent presets). The host injects the current Config into
  // the page as a small JSON bridge; the panel does not depend on the settings
  // namespace allowlist.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-custom-theme',
    order: 30,
    label: () => t('configTab'),
    locale: NS,
    inject: (): ThemeConfigTabInjected => ({
      config: readThemeConfig(),
    }),
  }, ThemeConfigTab))
}
