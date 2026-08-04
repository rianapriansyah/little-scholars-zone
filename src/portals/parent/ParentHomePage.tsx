import { useEffect, useState } from 'react'
import { Alert, Avatar, Box, CircularProgress, Divider, Paper, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useFamilyProfile } from '../../hooks/useFamilyProfile'
import { LearningPeriodDetail } from '../../components/LearningPeriodDetail'
import { fetchPeriodsForChild } from '../../lib/learningPeriods'
import type { LearningPeriodListEntry } from '../../types/attendance'
import type { ChildRow } from '../../types/child'

/**
 * One section per child, their billed programs beneath. A child enrolled in two separately
 * billed classrooms holds an independent period for each, so both appear here with their own
 * quota and attendance history.
 */
type ChildWithPeriods = {
  child: ChildRow
  periods: LearningPeriodListEntry[]
}

export function ParentHomePage() {
  const { user } = useAuth()
  const { family } = useFamilyProfile(user?.id)
  const [entries, setEntries] = useState<ChildWithPeriods[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!family) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      const { data: childRows, error: cError } = await supabase
        .from('children')
        .select('*')
        .eq('family_id', family.id)
        .order('full_name')
      if (cError) {
        if (!cancelled) {
          setError(cError.message)
          setLoading(false)
        }
        return
      }

      const results: ChildWithPeriods[] = []
      for (const child of childRows ?? []) {
        const periodResult = await fetchPeriodsForChild(child.id)
        if (!periodResult.ok) {
          if (!cancelled) {
            setError(periodResult.error)
            setLoading(false)
          }
          return
        }
        results.push({ child, periods: periodResult.data })
      }

      if (!cancelled) {
        setError(null)
        setEntries(results)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [family])

  if (!family || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mb: 2 }}>
        Anak Saya
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {entries.length === 0 ? (
        <Typography color="text.secondary">Belum ada data anak.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(({ child, periods }) => (
            <Box key={child.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Avatar src={child.photo_url ?? undefined} sx={{ width: 40, height: 40 }}>
                  {child.full_name.charAt(0).toUpperCase()}
                </Avatar>
                <Typography variant="h6" sx={{ fontSize: '1.15rem' }}>
                  {child.full_name}
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              {periods.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Belum ada program belajar yang terdaftar.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {periods.map((period) => (
                    // The child's name is the section heading above, so the card leads with
                    // the program instead of repeating it.
                    <Paper key={period.id} variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
                      <LearningPeriodDetail periodId={period.id} hideChildName />
                    </Paper>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
