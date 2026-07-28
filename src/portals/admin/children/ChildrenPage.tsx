import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Avatar, Box, Chip, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ChildView = ChildRow & { familyName: string; classroomLabel: string | null }

function childSearchBlob(row: ChildView): string {
  return `${row.full_name} ${row.familyName} ${row.classroomLabel ?? ''}`.toLowerCase()
}

export function ChildrenPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ChildView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [childrenRes, familiesRes, enrollmentsRes] = await Promise.all([
      supabase.from('children').select('*').order('full_name'),
      supabase.from('families').select('*'),
      supabase
        .from('children_classrooms')
        .select('child_id, classroom_teachers(classrooms(label), teachers(full_name))')
        .is('ended_at', null),
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
      const group = row.classroom_teachers as unknown as
        | { classrooms: { label: string } | null; teachers: { full_name: string } | null }
        | null
      if (group?.classrooms) {
        classroomByChild.set(row.child_id, `${group.classrooms.label} (${group.teachers?.full_name ?? '—'})`)
      }
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
      {
        field: 'full_name',
        headerName: 'Siswa',
        flex: 1,
        minWidth: 200,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
            <Avatar src={params.row.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
              {params.row.full_name.charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="body2">{params.row.full_name}</Typography>
          </Box>
        ),
      },
      {
        field: 'classroomLabel',
        headerName: 'Kelas',
        flex: 1,
        minWidth: 180,
        valueGetter: (_v, row) => row.classroomLabel ?? 'Belum Terdaftar',
      },
      {
        field: 'active',
        headerName: 'Status',
        width: 110,
        renderCell: (params) =>
          params.row.active ? (
            <Chip size="small" label="Aktif" color="success" variant="outlined" />
          ) : (
            <Chip size="small" label="Nonaktif" color="default" variant="outlined" />
          ),
      },
    ],
    [],
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Siswa
      </Typography>

      <DataGridSearchPanel
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSubmit={handleSearch}
        onClear={handleClear}
        searchPlaceholder="Cari nama, keluarga, kelas…"
        loading={loading}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {!loading && rows.length === 0 ? (
        <Typography color="text.secondary">Belum ada siswa.</Typography>
      ) : (
        <Box sx={{ width: '100%', minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {loading ? 'Memuat…' : `${filteredRows.length} siswa`}
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
              onRowClick={(params) =>
                navigate(`/admin/families/${params.row.family_id}`, { state: { focusChildId: params.row.id } })
              }
              sx={{ border: 'none', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}
    </Box>
  )
}
