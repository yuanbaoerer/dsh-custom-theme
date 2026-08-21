/**
 * Shared host-side types for dsh-custom-theme.
 *
 * Kept in one module so the plugin entry (`index.ts`) and the palette
 * analysis (`agent.ts`) agree on the persisted config and the model output
 * contract without a runtime import cycle.
 */

/**
 * One mode's tunable palette. Every key maps to a `--dsh-custom-theme-*`
 * variable injected by the host bridge; the shipped stylesheet keeps a
 * default, so an absent key falls back to the built-in palette.
 */
export interface Palette {
  /** Base backdrop color (solid or near-solid). */
  bgBase?: string
  /** Translucent surface layer 1 (input wells, cards). */
  layer1?: string
  /** Translucent surface layer 2. */
  layer2?: string
  /** Translucent surface layer 3. */
  layer3?: string
  /** Hairline border color. */
  border?: string
  /** Primary text color (solid, high contrast). */
  labelPrimary?: string
  /** Secondary text color (solid). */
  labelSecondary?: string
  /** Accent / brand color (buttons, active states). */
  brand?: string
}

/** One mode's palette as returned by the model (overlay included). */
export interface PaletteMode extends Palette {
  overlay?: string
}

/** Full analysis result written back into the plugin Config. */
export interface PaletteAnalysis {
  light: PaletteMode
  dark: PaletteMode
  rationale: string
}
