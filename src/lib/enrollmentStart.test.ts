import { describe, expect, it } from 'vitest'
import { enrollmentStartDefault } from './enrollmentStart'

describe('enrollmentStartDefault', () => {
  it('uses the learning period start for a first assignment', () => {
    expect(
      enrollmentStartDefault({ periodStart: '2026-10-01', hasPriorEnrollment: false, today: '2026-10-05' }),
    ).toBe('2026-10-01')
  })

  it('uses today when the child has been taught in this classroom before', () => {
    // A move between teachers partway through a period: the new teacher starts now, and
    // backdating would hand her days another teacher taught.
    expect(
      enrollmentStartDefault({ periodStart: '2026-10-01', hasPriorEnrollment: true, today: '2026-10-05' }),
    ).toBe('2026-10-05')
  })

  it('falls back to today when the child holds no period in this classroom', () => {
    expect(
      enrollmentStartDefault({ periodStart: null, hasPriorEnrollment: false, today: '2026-10-05' }),
    ).toBe('2026-10-05')
  })

  it('keeps a future period start rather than clamping it to today', () => {
    // Setting a class up a week ahead is legitimate; only starting before the period is not.
    expect(
      enrollmentStartDefault({ periodStart: '2026-10-12', hasPriorEnrollment: false, today: '2026-10-05' }),
    ).toBe('2026-10-12')
  })

  it('is exactly the reported bug: period backdated, paperwork filed days later', () => {
    // Ahmad Alfarezi Lamantogi — period from 1 Oktober, enrolled on the 5th, four days of
    // reports unwritable until this default existed.
    expect(
      enrollmentStartDefault({ periodStart: '2026-10-01', hasPriorEnrollment: false, today: '2026-10-05' }),
    ).not.toBe('2026-10-05')
  })
})
