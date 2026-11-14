import type { Database } from './database'

export type EmployeeRow = Database['public']['Tables']['employees']['Row']
export type EmployeeRoleRow = Database['public']['Tables']['employee_roles']['Row']
