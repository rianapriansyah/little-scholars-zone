import { useCallback, useEffect, useState } from 'react'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Avatar, Box, Button, Typography } from '@mui/material'
import { supabase } from '../../../lib/supabase'
import type { ChildRow } from '../../../types/child'
import { ChildDetailEditForm } from './ChildDetailEditForm'
import { ChildDialog } from '../children/ChildDialog'

type Props = {
  familyId: string
  /** Pre-expands this child's accordion (e.g. arriving from the Siswa grid). */
  initialExpandedId?: string
}

export function FamilyChildrenTab({ familyId, initialExpandedId }: Props) {
  const [children, setChildren] = useState<ChildRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | false>(initialExpandedId ?? false)
  const [addOpen, setAddOpen] = useState(false)

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
  }, [load])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" onClick={() => setAddOpen(true)}>
          Tambah Anak
        </Button>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!loading && children.length === 0 ? (
        <Typography color="text.secondary">Belum ada anak.</Typography>
      ) : (
        children.map((child) => (
          <Accordion
            key={child.id}
            expanded={expandedId === child.id}
            onChange={(_, isExpanded) => setExpandedId(isExpanded ? child.id : false)}
            disableGutters
            variant="outlined"
            sx={{ mb: 1, '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Avatar src={child.photo_url ?? undefined} sx={{ width: 32, height: 32 }}>
                  {child.full_name.charAt(0).toUpperCase()}
                </Avatar>
                <Typography>{child.full_name}</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              {expandedId === child.id ? <ChildDetailEditForm child={child} onSaved={() => void load()} /> : null}
            </AccordionDetails>
          </Accordion>
        ))
      )}

      <ChildDialog
        open={addOpen}
        child={null}
        familyId={familyId}
        onClose={() => setAddOpen(false)}
        onSaved={() => void load()}
      />
    </Box>
  )
}
