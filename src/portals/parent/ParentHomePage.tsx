import { useEffect, useState } from 'react'
import { Alert, Avatar, Box, CircularProgress, Divider, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useFamilyProfile } from '../../hooks/useFamilyProfile'
import { ProgramPeriodCard } from '../../components/ProgramPeriodCard'
import { fetchPeriodsForChild } from '../../lib/learningPeriods'
import { groupPeriodsByProgram, type ChildProgramGroup } from '../../lib/periodGrouping'
import type { ChildRow } from '../../types/child'

/**
 * One section per child, their billed programs beneath as collapsible cards — the same card the
 * admin period screen uses, minus its invoice and delete controls, so a parent reads exactly what
 * the centre sees without being offered anything to change.
 *
 * Grouped by program rather than listed per period: a renewal is the same program continuing, and
 * stacking each renewal as another full-height panel buried the one that is actually running.
 */
type ChildWithPeriods = {
  child: ChildRow
  programs: ChildProgramGroup[]
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
        results.push({ child, programs: groupPeriodsByProgram(periodResult.data) })
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
          {entries.map(({ child, programs }) => (
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

              {programs.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Belum ada program belajar yang terdaftar.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {programs.map((group, index) => (
                    // The child's name is the section heading above, so the card leads with the
                    // program instead of repeating it. Only the first opens: a parent with a
                    // child in two programs should see both at a glance, not scroll past one.
                    <ProgramPeriodCard
                      key={group.classroomId}
                      group={group}
                      defaultExpanded={index === 0}
                    />
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
