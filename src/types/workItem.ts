import type { Database } from './database'

export type WorkItemRow = Database['public']['Tables']['work_items']['Row']

/** A work item with its branch's name and how many assignments use it. */
export type WorkItemListEntry = WorkItemRow & { branchName: string; assignmentCount: number }
