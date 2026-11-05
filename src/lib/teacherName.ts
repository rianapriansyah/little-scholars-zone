import type { EmployeeRow } from '../types/employee'

/**
 * What to call a teacher on screen. `call_name` is the short name they are actually addressed
 * by ("Bu Reski"); `full_name` stays the formal record. A missing or blank call name falls
 * back, so nobody is ever greeted by an empty string.
 */
export function teacherDisplayName(teacher: Pick<EmployeeRow, 'call_name' | 'full_name'>): string {
  return teacher.call_name?.trim() || teacher.full_name
}
