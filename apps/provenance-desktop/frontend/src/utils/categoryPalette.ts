export type CategoryPaletteKey =
  | 'revenue'
  | 'expense'
  | 'internal-transfer'
  | 'loan'
  | 'owner-contribution'
  | 'refund'
  | 'salary'
  | 'tax-payment'
  | 'other'
  | 'exchange-deposit'
  | 'unknown'

const CATEGORY_TO_PALETTE_KEY: Record<string, CategoryPaletteKey> = {
  revenue: 'revenue',
  expense: 'expense',
  'internal transfer': 'internal-transfer',
  loan: 'loan',
  'owner contribution': 'owner-contribution',
  refund: 'refund',
  salary: 'salary',
  'tax payment': 'tax-payment',
  other: 'other',
  'exchange deposit': 'exchange-deposit',
  unknown: 'unknown',
}

const PALETTE_DISPLAY_LABEL: Record<CategoryPaletteKey, string> = {
  revenue: 'Revenue',
  expense: 'Expense',
  'internal-transfer': 'Internal Transfer',
  loan: 'Loan',
  'owner-contribution': 'Owner Contribution',
  refund: 'Refund',
  salary: 'Salary',
  'tax-payment': 'Tax Payment',
  other: 'Other',
  'exchange-deposit': 'Exchange Deposit',
  unknown: 'Unknown',
}

const PALETTE_SOLID_HEX: Record<CategoryPaletteKey, string> = {
  revenue: '#10b981',
  expense: '#ef4444',
  'internal-transfer': '#64748b',
  loan: '#a855f7',
  'owner-contribution': '#3b82f6',
  refund: '#f59e0b',
  salary: '#f97316',
  'tax-payment': '#f43f5e',
  other: '#6b7280',
  'exchange-deposit': '#06b6d4',
  unknown: '#94a3b8',
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

export function mapCategoryToDisplayLabel(category: string | null | undefined): string | null {
  const paletteKey = mapCategoryToPaletteKey(category)
  if (paletteKey === null) {
    return null
  }
  return PALETTE_DISPLAY_LABEL[paletteKey]
}

export function categoryColorHexByKey(paletteKey: CategoryPaletteKey | null): string | null {
  if (!paletteKey) {
    return null
  }
  return PALETTE_SOLID_HEX[paletteKey] ?? null
}

export function categoryColorHex(category: string | null | undefined): string | null {
  return categoryColorHexByKey(mapCategoryToPaletteKey(category))
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
