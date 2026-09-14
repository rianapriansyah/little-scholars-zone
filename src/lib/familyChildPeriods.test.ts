import { describe, expect, it } from 'vitest'
import { findChildPeriodError } from './familyChildPeriods'

const complete = { fullName: 'Budi', classroomId: 'c1', startDate: '2026-09-15' }

describe('findChildPeriodError', () => {
  it('passes when every named child has a class and start date', () => {
    expect(findChildPeriodError([complete, { ...complete, fullName: 'Sari' }])).toBeNull()
  })

  it('names the child missing a class', () => {
    expect(findChildPeriodError([complete, { ...complete, fullName: 'Sari', classroomId: '' }])).toBe(
      'Pilih kelas periode belajar untuk Sari.',
    )
  })

  it('names the child missing a start date', () => {
    expect(findChildPeriodError([{ ...complete, startDate: '' }])).toBe(
      'Isi tanggal mulai periode belajar untuk Budi.',
    )
  })

  it('ignores blank cards, which are dropped on save', () => {
    expect(findChildPeriodError([complete, { fullName: '   ', classroomId: '', startDate: '' }])).toBeNull()
  })

  it('trims the name it reports', () => {
    expect(findChildPeriodError([{ fullName: '  Budi ', classroomId: '', startDate: '' }])).toBe(
      'Pilih kelas periode belajar untuk Budi.',
    )
  })
})
