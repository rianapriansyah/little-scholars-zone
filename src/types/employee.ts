import type { Database } from './database'

export type EmployeeRow = Database['public']['Tables']['employees']['Row']
export type EmployeePositionRow = Database['public']['Tables']['employee_positions']['Row']
