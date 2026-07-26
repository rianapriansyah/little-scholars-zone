import { describe, expect, it } from 'vitest'
import { getClassStatus, getTodaysClassStartInWita } from './classStatus'

describe('getClassStatus', () => {
  const start = new Date('2026-07-14T02:00:00Z') // 10:00 WITA

  it('returns green once the start time has passed', () => {
    expect(getClassStatus(start, start).border).toBe('green')
    expect(getClassStatus(start, new Date(start.getTime() + 60_000))).toEqual({
      border: 'green',
      label: 'Kelas sedang berjalan',
    })
  })

  it('returns red within 10 minutes of start', () => {
    const now = new Date(start.getTime() - 10 * 60_000)
    expect(getClassStatus(start, now)).toEqual({ border: 'red', label: null })
    expect(getClassStatus(start, new Date(start.getTime() - 1 * 60_000)).border).toBe('red')
  })

  it('returns yellow within 30 minutes of start', () => {
    const now = new Date(start.getTime() - 30 * 60_000)
    expect(getClassStatus(start, now)).toEqual({ border: 'yellow', label: null })
    expect(getClassStatus(start, new Date(start.getTime() - 11 * 60_000)).border).toBe('yellow')
  })

  it('returns default outside 30 minutes of start', () => {
    const now = new Date(start.getTime() - 31 * 60_000)
    expect(getClassStatus(start, now)).toEqual({ border: 'default', label: null })
  })
})

describe('getTodaysClassStartInWita', () => {
  it('converts a WITA wall-clock time to the correct UTC instant on a weekday', () => {
    // 2026-07-14 is a Tuesday in WITA (UTC+8); pick a reference instant safely inside that WITA day.
    const referenceNow = new Date('2026-07-14T04:00:00Z') // 12:00 WITA, still Tuesday
    const result = getTodaysClassStartInWita('10:00', referenceNow)
    expect(result).toEqual(new Date('2026-07-14T02:00:00Z'))
  })

  it('returns null on a WITA weekend', () => {
    // 2026-07-18 is a Saturday in WITA (UTC+8).
    const referenceNow = new Date('2026-07-18T04:00:00Z') // 12:00 WITA, Saturday
    const result = getTodaysClassStartInWita('10:00', referenceNow)
    expect(result).toBeNull()
  })

  it('uses the WITA calendar date near a UTC midnight boundary, not the UTC date', () => {
    // 2026-07-13T17:00:00Z = 2026-07-14T01:00:00 WITA — already Tuesday in WITA, still Monday in UTC.
    const referenceNow = new Date('2026-07-13T17:00:00Z')
    expect(getTodaysClassStartInWita('10:00', referenceNow)).toEqual(new Date('2026-07-14T02:00:00Z'))
  })
})
