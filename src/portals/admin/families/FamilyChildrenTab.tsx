import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { supabase } from '../../../lib/supabase'
import { ResponsiveTableContainer } from '../../../components/ResponsiveTableContainer'
import type { ChildRow } from '../../../types/child'
import type { FamilyRow } from '../../../types/family'
import { ChildDetailDialog } from './ChildDetailDialog'

type Props = {
  familyId: string
  family: FamilyRow
  /** Bump to force a re-fetch (e.g. after adding a child from the page-level button). */
  refreshKey?: number
}

export function FamilyChildrenTab({ familyId, family, refreshKey }: Props) {
  const [children, setChildren] = useState<ChildRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qError } = await supabase
      .from('children')
      .select('*')
      .eq('family_id', familyId)
      .order('full_name')
    setLoading(false)
    if (qError) {
      setError(qError.message)
      return
    }
    setChildren(data ?? [])
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Read back out of the list rather than held on its own, so a save refreshes the open dialog.
  const selectedChild = children.find((c) => c.id === selectedId) ?? null

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!loading && children.length === 0 ? (
        <Typography color="text.secondary">Belum ada anak.</Typography>
      ) : (
        <ResponsiveTableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 56 }} />
                <TableCell>Nama Anak</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {children.map((child) => (
                <TableRow
                  key={child.id}
                  hover
                  onClick={() => setSelectedId(child.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Avatar src={child.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
                      {child.full_name.charAt(0).toUpperCase()}
                    </Avatar>
                  </TableCell>
                  <TableCell>{child.full_name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ResponsiveTableContainer>
      )}

      <ChildDetailDialog
        open={selectedChild !== null}
        child={selectedChild}
        family={family}
        onClose={() => setSelectedId(null)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
