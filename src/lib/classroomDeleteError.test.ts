import { describe, expect, it } from 'vitest'
import { classroomDeleteErrorMessage } from './classroomDeleteError'

/** The shape Postgres actually produces for a blocked DELETE, per referencing table. */
function fkViolation(table: string) {
  return {
    code: '23503',
    message: `update or delete on table "classrooms" violates foreign key constraint "${table}_classroom_id_fkey" on table "${table}"`,
    details: `Key (id)=(0f1c6d6e-0000-4000-8000-000000000000) is still referenced from table "${table}".`,
  }
}

describe('classroomDeleteErrorMessage', () => {
  it('blames enrollment history only when children_classrooms is the blocker', () => {
    expect(classroomDeleteErrorMessage(fkViolation('children_classrooms'))).toBe(
      'Tidak dapat dihapus: kelas ini memiliki riwayat pendaftaran siswa. Nonaktifkan saja.',
    )
  })

  it('names the assigned teacher as the blocker, not a student enrollment', () => {
    const message = classroomDeleteErrorMessage(fkViolation('classroom_teachers'))
    expect(message).toContain('guru yang ditugaskan')
    expect(message).not.toContain('pendaftaran siswa')
  })

  it('names a learning period as the blocker', () => {
    expect(classroomDeleteErrorMessage(fkViolation('children_learning_periods'))).toContain(
      'periode belajar tercatat',
    )
  })

  it('names a parent registration form as the blocker', () => {
    expect(classroomDeleteErrorMessage(fkViolation('registration_children'))).toContain(
      'formulir pendaftaran orang tua',
    )
  })

  it('falls back to the message when PostgREST withholds details', () => {
    expect(
      classroomDeleteErrorMessage({ ...fkViolation('classroom_teachers'), details: null }),
    ).toContain('guru yang ditugaskan')
  })

  it('still names the table when a new, unmapped foreign key blocks the delete', () => {
    expect(classroomDeleteErrorMessage(fkViolation('some_future_table'))).toBe(
      'Tidak dapat dihapus: kelas ini masih dipakai oleh data lain (some_future_table). Nonaktifkan saja.',
    )
  })

  it('stays generic when no table can be parsed out', () => {
    expect(
      classroomDeleteErrorMessage({ code: '23503', message: 'foreign key violation', details: null }),
    ).toBe('Tidak dapat dihapus: kelas ini masih dipakai oleh data lain. Nonaktifkan saja.')
  })

  it('passes any other error through untouched', () => {
    expect(
      classroomDeleteErrorMessage({ code: '42501', message: 'permission denied for table classrooms' }),
    ).toBe('permission denied for table classrooms')
  })
})
