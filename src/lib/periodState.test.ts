import { describe, expect, it } from 'vitest'
import { canMarkFinished, periodState, periodStateChipProps } from './periodState'

describe('canMarkFinished', () => {
  const today = '2026-11-13'
  const p = (o: Partial<Parameters<typeof canMarkFinished>[0]>) => ({
    isActive: false,
    closedAt: null,
    periodNo: 1,
    startDate: '2026-12-01',
    ...o,
  })

  it('offers it on a running period', () => {
    expect(canMarkFinished(p({ isActive: true }), [], today)).toBe(true)
  })

  it('never on a finished period', () => {
    expect(canMarkFinished(p({ closedAt: '2026-11-01T00:00:00Z', startDate: '2026-09-01' }), [], today)).toBe(false)
  })

  it('offers it on a Belum Mulai period whose start date has passed', () => {
    expect(canMarkFinished(p({ startDate: '2026-09-27' }), [], today)).toBe(true)
    expect(canMarkFinished(p({ startDate: '2026-11-12' }), [], today)).toBe(true)
  })

  it('not on a Belum Mulai period starting today or later with nothing after it', () => {
    expect(canMarkFinished(p({ startDate: today }), [], today)).toBe(false)
    expect(canMarkFinished(p({ startDate: '2026-12-01' }), [], today)).toBe(false)
  })

  it('still offers it on a future Belum Mulai period a later one has overtaken', () => {
    const later = p({ periodNo: 2, isActive: true })
    expect(canMarkFinished(p({ startDate: '2026-12-01' }), [later], today)).toBe(true)
  })
})

describe('periodState', () => {
  it('is active when the stored flag says so', () => {
    expect(periodState({ isActive: true, closedAt: null })).toBe('active')
  })

  it('is not started when open but not active (no attendance yet)', () => {
    expect(periodState({ isActive: false, closedAt: null })).toBe('not_started')
  })

  it('is finished once closed, whether by quota or Tandai Selesai', () => {
    expect(periodState({ isActive: false, closedAt: '2026-11-09T00:00:00Z' })).toBe('finished')
  })
})

describe('periodStateChipProps', () => {
  it('labels the three states in Indonesian, only Berjalan filled green', () => {
    expect(periodStateChipProps('active')).toEqual({ label: 'Berjalan', color: 'success', variant: 'filled' })
    expect(periodStateChipProps('not_started')).toEqual({ label: 'Belum Mulai', color: 'default', variant: 'outlined' })
    expect(periodStateChipProps('finished')).toEqual({ label: 'Selesai', color: 'default', variant: 'outlined' })
  })
})
