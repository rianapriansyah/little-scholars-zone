import { useCallback, useEffect, useMemo, useState } from 'react'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { Alert, Box, Button, Chip, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { ClassroomRow } from '../../../types/classroom'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ClassroomDialog } from './ClassroomDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ClassroomView = ClassroomRow & { enrolledCount: number }

function classroomSearchBlob(row: ClassroomView): string {
  return row.label.toLowerCase()
}

export function ClassroomsPage() {
  const [rows, setRows] = useState<ClassroomView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editClassroom, setEditClassroom] = useState<ClassroomRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ClassroomView | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [classroomsRes, groupsRes, enrollmentsRes] = await Promise.all([
      supabase.from('classrooms').select('*').order('label'),
      supabase.from('classroom_teachers').select('id, classroom_id'),
      supabase.from('children_classrooms').select('classroom_teacher_id').is('ended_at', null),
    ])
    setLoading(false)

    const qError = classroomsRes.error ?? groupsRes.error ?? enrollmentsRes.error
    if (qError) {
      setError(qError.message)
      return
    }

    const groupClassroomId = new Map<string, string>()
    for (const g of groupsRes.data ?? []) {
      groupClassroomId.set(g.id, g.classroom_id)
    }

    const countByClassroom = new Map<string, number>()
    for (const row of enrollmentsRes.data ?? []) {
      const classroomId = groupClassroomId.get(row.classroom_teacher_id)
      if (!classroomId) continue
      countByClassroom.set(classroomId, (countByClassroom.get(classroomId) ?? 0) + 1)
    }

    const views: ClassroomView[] = (classroomsRes.data ?? []).map((c) => ({
      ...c,
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

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error: dErr } = await supabase.from('classrooms').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (dErr) {
      setError(
        dErr.code === '23503'
          ? 'Cannot delete: this classroom has enrollment history. Mark it inactive instead.'
          : dErr.message,
      )
      return
    }
    void load()
  }

  const columns: GridColDef<ClassroomView>[] = useMemo(
    () => [
      { field: 'label', headerName: 'Classroom', flex: 1, minWidth: 200 },
      {
        field: 'time_start',
        headerName: 'Time',
        width: 110,
        valueGetter: (_v, row) =>
          row.time_end ? `${row.time_start.slice(0, 5)}–${row.time_end.slice(0, 5)}` : row.time_start.slice(0, 5),
      },
      {
        field: 'enrolledCount',
        headerName: 'Roster',
        width: 90,
        valueGetter: (_v, row) => `${row.enrolledCount}`,
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
        width: 104,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <>
            <DataGridUpdateIconButton
              onClick={() => {
                setEditClassroom(params.row)
                setDialogOpen(true)
              }}
            />
            <Tooltip title="Delete">
              <IconButton
                size="small"
                aria-label="Delete"
                sx={{ my: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteTarget(params.row)
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Kelas
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Search label…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          sx={{ maxWidth: { xs: '100%', sm: 200 } }}
          onClick={() => {
            setEditClassroom(null)
            setDialogOpen(true)
          }}
        >
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
      <ClassroomDialog
        open={dialogOpen}
        classroom={editClassroom}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus Kelas"
        description={`Delete "${deleteTarget?.label}"? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </Box>
  )
}
