import type { Database } from './database'

export type ProgramRow = Database['public']['Tables']['programs']['Row']

/** A program with its branch's name and how many class slots (classrooms) belong to it. */
export type ProgramListEntry = ProgramRow & { branchName: string; classCount: number }
