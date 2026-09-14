import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Box, Paper, Typography } from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import dayjs from 'dayjs'
import { DataGridSearchPanel } from '../../../components/DataGridSearchPanel'
import { supabase } from '../../../lib/supabase'
import { formatAge } from '../../../lib/calculateAge'
import { familyDisplayName } from '../../../lib/familyDisplayName'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { matchesSearchTokens } from '../../../lib/matchesSearchTokens'
import { ChildDetailDialog } from '../families/ChildDetailDialog'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

type ChildView = ChildRow & { familyName: string; classroomLabel: string | null }

function childSearchBlob(row: ChildView): string {
  return `${row.full_name} ${row.familyName} ${row.classroomLabel ?? ''}`.toLowerCase()
}

export function ChildrenPage() {
  const [rows, setRows] = useState<ChildView[]>([])
  const [familyById, setFamilyById] = useState<Map<string, FamilyRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 })
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

    const families = new Map<string, FamilyRow>((familiesRes.data ?? []).map((f) => [f.id, f]))
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
      familyName: families.has(c.family_id) ? familyDisplayName(families.get(c.family_id)!) : '—',
      classroomLabel: classroomByChild.get(c.id) ?? null,
    }))
    setFamilyById(families)
    setRows(views)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearchTokens(childSearchBlob(row), keyword)),
    [rows, keyword],
  )

  // Read back out of the grid rows rather than held on its own, so a save refreshes the open dialog.
  const selectedChild = rows.find((row) => row.id === selectedId) ?? null
  const selectedFamily = selectedChild ? (familyById.get(selectedChild.family_id) ?? null) : null

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
        renderCell: (params) => {
          const age = params.row.birthdate ? formatAge(dayjs(params.row.birthdate)) : null
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: '100%' }}>
              <Avatar src={params.row.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
                {params.row.full_name.charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {params.row.full_name}
                </Typography>
                {age ? (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    ({age})
                  </Typography>
                ) : null}
              </Box>
            </Box>
          )
        },
      },
      {
        field: 'classroomLabel',
        headerName: 'Kelas',
        flex: 1,
        minWidth: 180,
        valueGetter: (_v, row) => row.classroomLabel ?? 'Belum Terdaftar',
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
              onRowClick={(params) => setSelectedId(params.row.id)}
              sx={{ border: 'none', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Paper>
        </Box>
      )}

      {/* Periods are priced from the family, so the dialog can only open once that row is known. */}
      {selectedFamily ? (
        <ChildDetailDialog
          open={selectedChild !== null}
          child={selectedChild}
          family={selectedFamily}
          onClose={() => setSelectedId(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </Box>
  )
}
