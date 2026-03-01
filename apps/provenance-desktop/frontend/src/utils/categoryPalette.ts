export type CategoryPaletteKey =
  | 'revenue'
  | 'expense'
  | 'internal-transfer'
  | 'exchange-deposit'
  | 'unknown'

const CATEGORY_TO_PALETTE_KEY: Record<string, CategoryPaletteKey> = {
  revenue: 'revenue',
  expense: 'expense',
  'internal transfer': 'internal-transfer',
  'exchange deposit': 'exchange-deposit',
  unknown: 'unknown',
}

function normalizeCategory(category: string): string {
  return category.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

export function hasCategory(category: string | null | undefined): category is string {
  return typeof category === 'string' && category.trim().length > 0
}

export function mapCategoryToPaletteKey(category: string | null | undefined): CategoryPaletteKey | null {
  if (!hasCategory(category)) {
    return null
  }

  const normalizedCategory = normalizeCategory(category)
  return CATEGORY_TO_PALETTE_KEY[normalizedCategory] ?? 'unknown'
}

export type ResolvedCategoryNodeStyle = {
  paletteKey: CategoryPaletteKey | null
  showNeutralIndicator: boolean
}

export function resolveCategoryNodeStyle(
  category: string | null | undefined,
  colorByCategoryEnabled: boolean,
): ResolvedCategoryNodeStyle {
  if (!colorByCategoryEnabled) {
    return { paletteKey: null, showNeutralIndicator: false }
  }

  const paletteKey = mapCategoryToPaletteKey(category)
  if (paletteKey === null) {
    return { paletteKey: null, showNeutralIndicator: true }
  }

  return { paletteKey, showNeutralIndicator: false }
}
