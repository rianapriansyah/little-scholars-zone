import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import type { TeacherRow } from '../../../types/teacher'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { ClassroomAssignmentDialog } from './ClassroomAssignmentDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ClassroomView = ClassroomRow & { teacherName: string; enrolledCount: number }

function classroomSearchBlob(row: ClassroomView): string {
  return `${row.label} ${row.teacherName} ${row.days_of_week.join(' ')}`.toLowerCase()
}

export function ClassroomAssignmentsPage() {
  const [rows, setRows] = useState<ClassroomView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeClassroom, setActiveClassroom] = useState<ClassroomRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [classroomsRes, teachersRes, enrollmentsRes] = await Promise.all([
      supabase.from('classrooms').select('*').order('label'),
      supabase.from('teachers').select('*'),
      supabase.from('children_classrooms').select('classroom_id').is('ended_at', null),
    ])
    setLoading(false)

    const qError = classroomsRes.error ?? teachersRes.error ?? enrollmentsRes.error
    if (qError) {
      setError(qError.message)
      return
    }

    const teacherById = new Map<string, TeacherRow>((teachersRes.data ?? []).map((t) => [t.id, t]))
    const countByClassroom = new Map<string, number>()
    for (const row of enrollmentsRes.data ?? []) {
      countByClassroom.set(row.classroom_id, (countByClassroom.get(row.classroom_id) ?? 0) + 1)
    }

    const views: ClassroomView[] = (classroomsRes.data ?? []).map((c) => ({
      ...c,
      teacherName: (c.teacher_id ? teacherById.get(c.teacher_id)?.full_name : undefined) ?? 'Unassigned',
      enrolledCount: countByClassroom.get(c.id) ?? 0,
    }))
    setRows(views)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(classroomSearchBlob(row), keyword)),
    [rows, keyword],
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const handleClear = () => {
    setKeyword('')
    setPaginationModel((m) => ({ ...m, page: 0 }))
  }

  const columns: GridColDef<ClassroomView>[] = useMemo(
    () => [
      { field: 'label', headerName: 'Classroom', flex: 1, minWidth: 200 },
      {
        field: 'teacherName',
        headerName: 'Teacher',
        flex: 1,
        minWidth: 140,
        renderCell: (params) =>
          params.row.teacher_id ? (
            params.value
          ) : (
            <Chip size="small" label="Unassigned" color="warning" variant="outlined" />
          ),
      },
      {
        field: 'enrolledCount',
        headerName: 'Roster',
        width: 100,
        valueGetter: (_v, row) => `${row.enrolledCount}/${row.capacity}`,
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 72,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <DataGridUpdateIconButton
            title="Assign"
            onClick={() => {
              setActiveClassroom(params.row)
              setDialogOpen(true)
            }}
          />
        ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Assignments
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Assign a teacher and enroll or remove students for each classroom.
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Search label, teacher…"
        loading={loading}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">No classrooms yet.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Loading…' : `${filteredRows.length} classrooms`}
          </Typography>
          <Paper sx={{ width: '100%', minWidth: 0, overflow: 'hidden', mt: error ? 2 : 0 }} variant="outlined">
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              disableRowSelectionOnClick
              autoHeight
              sx={{ border: 'none' }}
            />
          </Paper>
        </Box>
      )}
      <ClassroomAssignmentDialog
        open={dialogOpen}
        classroom={activeClassroom}
        onClose={() => setDialogOpen(false)}
        onAssigned={() => void load()}
      />
    </Box>
  )
}
