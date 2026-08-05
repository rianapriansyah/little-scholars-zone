import { describe, expect, it } from 'vitest'
import {
  formatWitaDayAndDate,
  getClassStatus,
  getClockInWindowStatus,
  getTodaysClassEndInWita,
  getTodaysClassStartInWita,
  isClockOutWindowOpen,
  isWitaClassDay,
  todayIsoDateInWita,
  witaWallClockTime,
  witaWallClockToIso,
} from './classStatus'

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

describe('getClassStatus with an end time', () => {
  const start = new Date('2026-07-14T02:00:00Z') // 10:00 WITA
  const end = new Date('2026-07-14T04:00:00Z') //   12:00 WITA

  it('reports the class finished once the end time has passed', () => {
    const now = new Date(end.getTime() + 60_000)
    expect(getClassStatus(start, now, end)).toEqual({ border: 'default', label: 'Kelas selesai' })
  })

  it('finishes exactly at the end time, not a moment later', () => {
    expect(getClassStatus(start, end, end).label).toBe('Kelas selesai')
    expect(getClassStatus(start, new Date(end.getTime() - 1), end).label).toBe('Kelas sedang berjalan')
  })

  it('still reports in-progress between start and end', () => {
    const midway = new Date(start.getTime() + 30 * 60_000)
    expect(getClassStatus(start, midway, end)).toEqual({ border: 'green', label: 'Kelas sedang berjalan' })
  })

  it('finished wins over the started check hours later, which was the bug', () => {
    const evening = new Date('2026-07-14T13:00:00Z') // 21:00 WITA, long after class
    expect(getClassStatus(start, evening, end).label).toBe('Kelas selesai')
    // Without an end time there is nothing to compare against, so it stays green.
    expect(getClassStatus(start, evening, null).label).toBe('Kelas sedang berjalan')
  })

  it('leaves the pre-start countdown untouched', () => {
    const fiveBefore = new Date(start.getTime() - 5 * 60_000)
    expect(getClassStatus(start, fiveBefore, end)).toEqual({ border: 'red', label: null })
  })
})

describe('getClockInWindowStatus', () => {
  const start = new Date('2026-07-14T02:00:00Z') // 10:00 WITA

  it('is open exactly at the start time', () => {
    expect(getClockInWindowStatus(start, start)).toBe('open')
  })

  it('is open up to 5 minutes before start', () => {
    expect(getClockInWindowStatus(start, new Date(start.getTime() - 5 * 60_000))).toBe('open')
  })

  it('is too_early more than 5 minutes before start', () => {
    expect(getClockInWindowStatus(start, new Date(start.getTime() - 5 * 60_000 - 1))).toBe('too_early')
  })

  it('is open up to 5 minutes after start', () => {
    expect(getClockInWindowStatus(start, new Date(start.getTime() + 5 * 60_000))).toBe('open')
  })

  it('is missed more than 5 minutes after start', () => {
    expect(getClockInWindowStatus(start, new Date(start.getTime() + 5 * 60_000 + 1))).toBe('missed')
  })
})

describe('isClockOutWindowOpen', () => {
  const end = new Date('2026-07-14T04:00:00Z') // 12:00 WITA

  it('is closed more than 5 minutes before end', () => {
    expect(isClockOutWindowOpen(end, new Date(end.getTime() - 5 * 60_000 - 1))).toBe(false)
  })

  it('opens exactly 5 minutes before end', () => {
    expect(isClockOutWindowOpen(end, new Date(end.getTime() - 5 * 60_000))).toBe(true)
  })

  it('stays open at the end time', () => {
    expect(isClockOutWindowOpen(end, end)).toBe(true)
  })

  it('stays open indefinitely after end, unlike the clock-in window', () => {
    expect(isClockOutWindowOpen(end, new Date(end.getTime() + 3 * 60 * 60_000))).toBe(true)
  })
})

describe('getTodaysClassEndInWita', () => {
  it('converts the end time the same way as the start time', () => {
    const referenceNow = new Date('2026-07-14T04:00:00Z') // 12:00 WITA, Tuesday
    expect(getTodaysClassEndInWita('12:00', referenceNow)).toEqual(new Date('2026-07-14T04:00:00Z'))
  })

  it('returns null when the classroom has no end time recorded', () => {
    expect(getTodaysClassEndInWita(null, new Date('2026-07-14T04:00:00Z'))).toBeNull()
  })

  it('returns null on a WITA weekend, like the start helper', () => {
    expect(getTodaysClassEndInWita('12:00', new Date('2026-07-18T04:00:00Z'))).toBeNull()
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

describe('isWitaClassDay', () => {
  it('is true Monday through Friday', () => {
    expect(isWitaClassDay(new Date('2026-08-03T04:00:00Z'))).toBe(true) // Monday
    expect(isWitaClassDay(new Date('2026-08-07T04:00:00Z'))).toBe(true) // Friday
  })

  it('is false at the weekend', () => {
    expect(isWitaClassDay(new Date('2026-08-08T04:00:00Z'))).toBe(false) // Saturday
    expect(isWitaClassDay(new Date('2026-08-09T04:00:00Z'))).toBe(false) // Sunday
  })

  it('judges by the WITA day, not UTC', () => {
    // 2026-08-07T17:00:00Z = Saturday 01:00 WITA, still Friday in UTC.
    expect(isWitaClassDay(new Date('2026-08-07T17:00:00Z'))).toBe(false)
  })
})

describe('formatWitaDayAndDate', () => {
  it('names the day in Indonesian and pads to DD-MM-YYYY', () => {
    // 2026-08-03 is a Monday in WITA.
    expect(formatWitaDayAndDate(new Date('2026-08-03T04:00:00Z'))).toBe('Senin, 03-08-2026')
  })

  it('covers the rest of the week', () => {
    expect(formatWitaDayAndDate(new Date('2026-08-07T04:00:00Z'))).toBe('Jumat, 07-08-2026')
    expect(formatWitaDayAndDate(new Date('2026-08-08T04:00:00Z'))).toBe('Sabtu, 08-08-2026')
    expect(formatWitaDayAndDate(new Date('2026-08-09T04:00:00Z'))).toBe('Minggu, 09-08-2026')
  })

  it('uses the WITA day, not the browser/UTC one, near midnight', () => {
    // 2026-08-02T17:30:00Z = 2026-08-03T01:30 WITA — Monday there, still Sunday in UTC.
    expect(formatWitaDayAndDate(new Date('2026-08-02T17:30:00Z'))).toBe('Senin, 03-08-2026')
  })
})

describe('witaWallClockToIso', () => {
  it('interprets the given date and time as WITA (UTC+8)', () => {
    expect(witaWallClockToIso('2026-08-05', '10:00')).toBe(new Date('2026-08-05T02:00:00Z').toISOString())
  })

  it('handles a date near UTC midnight correctly', () => {
    expect(witaWallClockToIso('2026-08-05', '01:00')).toBe(new Date('2026-08-04T17:00:00Z').toISOString())
  })
})

describe('witaWallClockTime', () => {
  it('formats an instant as its WITA wall-clock HH:mm', () => {
    expect(witaWallClockTime(new Date('2026-08-05T02:00:00Z').toISOString())).toBe('10:00')
  })

  it('round-trips with witaWallClockToIso', () => {
    const iso = witaWallClockToIso('2026-08-05', '14:37')
    expect(witaWallClockTime(iso)).toBe('14:37')
  })
})

describe('todayIsoDateInWita', () => {
  it('returns the WITA calendar date, zero-padded', () => {
    expect(todayIsoDateInWita(new Date('2026-08-02T04:00:00Z'))).toBe('2026-08-02')
  })

  it('rolls to the next day before UTC midnight, so a report is filed under the right day', () => {
    // 2026-08-02T17:30:00Z = 2026-08-03T01:30 WITA — already the 3rd where the teacher is.
    expect(todayIsoDateInWita(new Date('2026-08-02T17:30:00Z'))).toBe('2026-08-03')
  })
})
