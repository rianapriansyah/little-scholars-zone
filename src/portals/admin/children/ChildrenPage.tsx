import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { DataGridUpdateIconButton } from '../../../components/DataGridUpdateIconButton'
import { ChildFormDialog } from './ChildFormDialog'
import { ChildManageDialog } from './ChildManageDialog'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ChildView = ChildRow & { familyName: string; classroomLabel: string | null }

function childSearchBlob(row: ChildView): string {
  return `${row.full_name} ${row.familyName} ${row.classroomLabel ?? ''}`.toLowerCase()
}

export function ChildrenPage() {
  const [rows, setRows] = useState<ChildView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [manageChild, setManageChild] = useState<ChildRow | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [childrenRes, familiesRes, enrollmentsRes] = await Promise.all([
      supabase.from('children').select('*').order('full_name'),
      supabase.from('families').select('*'),
      supabase.from('children_classrooms').select('child_id, classrooms(label)').is('ended_at', null),
    ])
    setLoading(false)

    const qError = childrenRes.error ?? familiesRes.error ?? enrollmentsRes.error
    if (qError) {
      setError(qError.message)
      return
    }

    const familyById = new Map<string, FamilyRow>((familiesRes.data ?? []).map((f) => [f.id, f]))
    const classroomByChild = new Map<string, string>()
    for (const row of enrollmentsRes.data ?? []) {
      const classroom = row.classrooms as unknown as { label: string } | null
      if (classroom) classroomByChild.set(row.child_id, classroom.label)
    }

    const views: ChildView[] = (childrenRes.data ?? []).map((c) => ({
      ...c,
      familyName: familyById.get(c.family_id)?.name ?? '—',
      classroomLabel: classroomByChild.get(c.id) ?? null,
    }))
    setRows(views)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(childSearchBlob(row), keyword)),
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

  const columns: GridColDef<ChildView>[] = useMemo(
    () => [
      { field: 'full_name', headerName: 'Child', flex: 1, minWidth: 160 },
      { field: 'familyName', headerName: 'Family', flex: 1, minWidth: 160 },
      {
        field: 'classroomLabel',
        headerName: 'Classroom',
        flex: 1,
        minWidth: 180,
        valueGetter: (_v, row) => row.classroomLabel ?? 'Not enrolled',
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
          <DataGridUpdateIconButton onClick={() => setManageChild(params.row)} />
        ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Children
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Search name, family, classroom…"
        loading={loading}
      />

      <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mb: 2 }}>
        <Button variant="contained" fullWidth sx={{ maxWidth: { xs: '100%', sm: 200 } }} onClick={() => setDialogOpen(true)}>
          Add child
        </Button>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">No children yet.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Loading…' : `${filteredRows.length} children`}
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
      <ChildFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
      <ChildManageDialog
        open={manageChild !== null}
        child={manageChild}
        onClose={() => setManageChild(null)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
