import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import type { TeacherRow } from '../../../types/teacher'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { ClassroomFormDialog } from './ClassroomFormDialog'
import { ClassroomManageDialog } from './ClassroomManageDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ClassroomView = ClassroomRow & { teacherName: string; enrolledCount: number }

function classroomSearchBlob(row: ClassroomView): string {
  return `${row.label} ${row.teacherName} ${row.day_of_week}`.toLowerCase()
}

export function ClassroomsPage() {
  const [rows, setRows] = useState<ClassroomView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [manageClassroom, setManageClassroom] = useState<ClassroomRow | null>(null)
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
      teacherName: teacherById.get(c.teacher_id)?.full_name ?? '—',
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
      { field: 'teacherName', headerName: 'Teacher', flex: 1, minWidth: 140 },
      { field: 'day_of_week', headerName: 'Day', width: 110 },
      { field: 'time_start', headerName: 'Time', width: 90, valueGetter: (_v, row) => row.time_start.slice(0, 5) },
      {
        field: 'enrolledCount',
        headerName: 'Roster',
        width: 100,
        valueGetter: (_v, row) => `${row.enrolledCount}/${row.capacity}`,
      },
      {
        field: 'active',
        headerName: 'Status',
        width: 110,
        renderCell: (params) =>
          params.row.active ? (
            <Chip size="small" label="Active" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Inactive" color="default" variant="outlined" />
          ),
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
          <DataGridUpdateIconButton onClick={() => setManageClassroom(params.row)} />
        ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Classrooms
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Search label, teacher, day…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button variant="contained" fullWidth sx={{ maxWidth: { xs: '100%', sm: 200 } }} onClick={() => setDialogOpen(true)}>
          Add classroom
        </Button>
      </Box>

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
      <ClassroomFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
      <ClassroomManageDialog
        open={manageClassroom !== null}
        classroom={manageClassroom}
        onClose={() => setManageClassroom(null)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
