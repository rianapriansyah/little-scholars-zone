import { describe, expect, it } from 'vitest'
import { periodState, periodStateChipProps } from './periodState'

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
