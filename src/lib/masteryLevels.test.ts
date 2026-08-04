import { describe, expect, it } from 'vitest'
import { MASTERY_LEVELS, isMasteryLevel, masteryLabel, masteryShortLabel } from './masteryLevels'

describe('MASTERY_LEVELS', () => {
  it('is exactly the 1..5 scale the DB CHECK constraint allows', () => {
    expect(MASTERY_LEVELS.map((m) => m.level)).toEqual([1, 2, 3, 4, 5])
  })

  it('has a distinct full and short label for every level', () => {
    expect(new Set(MASTERY_LEVELS.map((m) => m.label)).size).toBe(5)
    expect(new Set(MASTERY_LEVELS.map((m) => m.short)).size).toBe(5)
  })
})

describe('label lookups', () => {
  it('indexes by level, not by array position', () => {
    expect(masteryLabel(1)).toBe('Diperkenalkan')
    expect(masteryLabel(5)).toBe('Mahir — lancar dan konsisten')
    expect(masteryShortLabel(4)).toBe('Mandiri')
  })
})

describe('isMasteryLevel', () => {
  it('guards the smallint coming back from Postgres', () => {
    expect(isMasteryLevel(3)).toBe(true)
    expect(isMasteryLevel(0)).toBe(false)
    expect(isMasteryLevel(6)).toBe(false)
  })
})
