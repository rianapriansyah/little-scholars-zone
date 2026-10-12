import { describe, expect, it } from 'vitest'
import { buildAttendanceReminderMessage } from './attendanceReminderMessage'
import type { ClassAttendanceGap } from './childAttendanceGaps'

const DATE = '2026-10-12'

function cls(overrides: Partial<ClassAttendanceGap> = {}): ClassAttendanceGap {
  return {
    classroomTeacherId: 'ct1',
    classroomId: 'c1',
    classroomLabel: 'Kelas Bintang',
    teacherId: 't1',
    teacherName: 'Bu Rina',
    teacherPhone: '081234567890',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    unfilled: [
      { childId: 'child1', childName: 'Adi' },
      { childId: 'child2', childName: 'Bima' },
    ],
    eligibleCount: 3,
    ...overrides,
  }
}

describe('buildAttendanceReminderMessage', () => {
  it('names the class, the date and every unfilled student', () => {
    expect(buildAttendanceReminderMessage({ teacherName: 'Bu Rina', classes: [cls()] }, DATE)).toBe(
      [
        'Hai Bu Rina,',
        '',
        'Absensi siswa berikut belum diisi untuk tanggal 12-Oktober-2026:',
        '',
        'Kelas Bintang (08:00–10:00)',
        '1. Adi',
        '2. Bima',
        '',
        'Mohon diisi di Laporan Harian ya. Terima kasih!',
      ].join('\n'),
    )
  })

  it('covers every class of the teacher in one message, numbering each separately', () => {
    const group = {
      teacherName: 'Bu Rina',
      classes: [
        cls(),
        cls({
          classroomTeacherId: 'ct2',
          classroomLabel: 'Kelas Pelangi',
          timeStart: '13:30:00',
          timeEnd: '15:30:00',
          unfilled: [{ childId: 'child3', childName: 'Citra' }],
        }),
      ],
    }
    expect(buildAttendanceReminderMessage(group, DATE)).toBe(
      [
        'Hai Bu Rina,',
        '',
        'Absensi siswa berikut belum diisi untuk tanggal 12-Oktober-2026:',
        '',
        'Kelas Bintang (08:00–10:00)',
        '1. Adi',
        '2. Bima',
        '',
        'Kelas Pelangi (13:30–15:30)',
        '1. Citra',
        '',
        'Mohon diisi di Laporan Harian ya. Terima kasih!',
      ].join('\n'),
    )
  })

  it('drops the seconds from the scheduled times', () => {
    const message = buildAttendanceReminderMessage(
      { teacherName: 'Bu Rina', classes: [cls({ timeStart: '13:30:00', timeEnd: '15:30:00' })] },
      DATE,
    )
    expect(message).toContain('(13:30–15:30)')
  })

  it('numbers a single student as 1', () => {
    const message = buildAttendanceReminderMessage(
      { teacherName: 'Bu Rina', classes: [cls({ unfilled: [{ childId: 'child1', childName: 'Adi' }] })] },
      DATE,
    )
    expect(message).toContain('1. Adi')
    expect(message).not.toContain('2.')
  })
})
