import { isPreset, PRESETS, rangeFor, type Preset } from './time'

export const DEFAULT_PRESET: Preset = '7d'

export function presetFrom(searchParams: Record<string, string | string[] | undefined> | undefined): Preset {
  const v = searchParams?.range
  return isPreset(v) ? v : DEFAULT_PRESET
}

export function resolveRange(preset: Preset) {
  return { preset, label: PRESETS[preset], ...rangeFor(preset) }
}
