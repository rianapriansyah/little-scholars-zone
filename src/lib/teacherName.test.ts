import { describe, expect, it } from 'vitest'
import { teacherDisplayName } from './teacherName'

describe('teacherDisplayName', () => {
  it('prefers the call name', () => {
    expect(teacherDisplayName({ call_name: 'Bu Reski', full_name: 'Rezeki Ramadhani' })).toBe('Bu Reski')
  })

  it('falls back to the full name when the call name is unset', () => {
    expect(teacherDisplayName({ call_name: null, full_name: 'Rezeki Ramadhani' })).toBe('Rezeki Ramadhani')
  })

  it('falls back when the call name is blank or whitespace, not just null', () => {
    expect(teacherDisplayName({ call_name: '', full_name: 'Rezeki Ramadhani' })).toBe('Rezeki Ramadhani')
    expect(teacherDisplayName({ call_name: '   ', full_name: 'Rezeki Ramadhani' })).toBe('Rezeki Ramadhani')
  })

  it('trims a padded call name rather than rendering the padding', () => {
    expect(teacherDisplayName({ call_name: '  Bu Reski  ', full_name: 'Rezeki Ramadhani' })).toBe('Bu Reski')
  })
})
