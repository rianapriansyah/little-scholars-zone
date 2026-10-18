import { useEffect, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { declareSubstitution, fetchSubstitutableGroupsToday } from '../../lib/substitutions'
import { SUBSTITUTE_BLOCK_LABELS, substituteBlockReason } from '../../lib/substitutionRules'
import type { SubstitutableGroup } from '../../types/substitution'

/**
 * "Gantikan Kelas": a teacher takes over an absent colleague's group for today, when there is no
 * admin around to assign it. Lists what she is allowed to cover and why anything else is closed
 * to her — the server re-checks every rule in declare_substitution, so the greying here is there
 * to explain, not to enforce.
 *
 * Today only, deliberately: the RPC takes no date at all, so backdating coverage is an admin
 * action rather than something a teacher can reach.
 */
export function SubstituteDeclareDialog({
  open,
  ownGroups,
  onClose,
  onDeclared,
}: {
  open: boolean
  /** Everything she already holds today, for the clash check. Includes coverage already taken. */
  ownGroups: { classroomId: string; timeStart: string; timeEnd: string | null }[]
  onClose: () => void
  onDeclared: () => void
}) {
  const [groups, setGroups] = useState<SubstitutableGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setSelectedId(null)
    setReason('')

    void (async () => {
      const result = await fetchSubstitutableGroupsToday()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }
      setGroups(result.data)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  async function handleDeclare() {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    const result = await declareSubstitution({ classroomTeacherId: selectedId, reason })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDeclared()
  }

  const selected = groups.find((group) => group.classroomTeacherId === selectedId) ?? null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        Gantikan Kelas
        <IconButton onClick={onClose} size="small" aria-label="Tutup">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pilih kelas yang Anda gantikan hari ini. Setelah dipilih, Anda bisa mengisi absensi dan
          Catatan Guru kelas tersebut — dan nama Anda yang tampil di laporan orang tua.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : groups.length === 0 ? (
          <Typography color="text.secondary">Tidak ada kelas guru lain yang bisa digantikan hari ini.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {groups.map((group) => {
              const blocked = substituteBlockReason(group, ownGroups)
              const time = `${group.timeStart.slice(0, 5)}${group.timeEnd ? `–${group.timeEnd.slice(0, 5)}` : ''}`
              return (
                <Paper
                  key={group.classroomTeacherId}
                  variant="outlined"
                  sx={
                    selectedId === group.classroomTeacherId
                      ? { borderColor: 'primary.main', borderWidth: 2 }
                      : undefined
                  }
                >
                  <ListItemButton
                    disabled={blocked !== null || saving}
                    onClick={() => setSelectedId(group.classroomTeacherId)}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={`${group.label} · ${time}`}
                      secondary={
                        blocked
                          ? SUBSTITUTE_BLOCK_LABELS[blocked]
                          : group.assignedTeacherName
                            ? `Kelas ${group.assignedTeacherName}`
                            : undefined
                      }
                    />
                  </ListItemButton>
                </Paper>
              )
            })}
          </Box>
        )}

        {selected ? (
          <TextField
            label="Alasan (opsional)"
            placeholder="Contoh: Bu Rina izin sakit"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Batal
        </Button>
        <Button variant="contained" disabled={!selectedId || saving} onClick={() => void handleDeclare()}>
          {saving ? 'Menyimpan…' : 'Gantikan Kelas Ini'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
