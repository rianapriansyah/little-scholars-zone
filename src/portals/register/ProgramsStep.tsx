import { Alert, Box, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { formatIdr } from '../../lib/formatIdr'
import { mandatoryFeeTotal, type DraftChild, type FeeItemOption, type ProgramOption } from '../../lib/registrationDraft'

type Props = {
  children: DraftChild[]
  programs: ProgramOption[]
  feeItems: FeeItemOption[]
  onChange: (children: DraftChild[]) => void
}

export function ProgramsStep({ children, programs, feeItems, onChange }: Props) {
  const byId = new Map(programs.map((program) => [program.id, program]))
  const programsTotal = children.reduce((sum, child) => sum + (byId.get(child.classroomId)?.price ?? 0), 0)
  const equipmentTotal = mandatoryFeeTotal(feeItems) * children.length

  function setClassroom(key: string, classroomId: string) {
    onChange(children.map((child) => (child.key === key ? { ...child, classroomId } : child)))
  }

  if (programs.length === 0) {
    return <Alert severity="warning">Belum ada program yang tersedia saat ini. Hubungi admin pusat.</Alert>
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children.map((child, index) => {
        const selected = byId.get(child.classroomId)
        return (
          <Paper key={child.key} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {child.fullName.trim() || `Anak ${index + 1}`}
            </Typography>
            <TextField
              size="small"
              select
              label="Program"
              value={child.classroomId}
              onChange={(e) => setClassroom(child.key, e.target.value)}
              fullWidth
              required
            >
              {programs.map((program) => (
                <MenuItem key={program.id} value={program.id}>
                  {program.label} · {program.timeStart.slice(0, 5)}–{program.timeEnd.slice(0, 5)} ·{' '}
                  {formatIdr(program.price)}
                </MenuItem>
              ))}
            </TextField>
            {selected ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {selected.guaranteedDays} hari efektif · {formatIdr(selected.price)}
              </Typography>
            ) : null}
          </Paper>
        )
      })}

      <Alert severity="info">
        Biaya Program: <strong>{formatIdr(programsTotal)}</strong>
        {equipmentTotal > 0 ? (
          <>
            {' '}
            + Perlengkapan Wajib: <strong>{formatIdr(equipmentTotal)}</strong>
            <br />
            <Typography component="span" variant="body2">
              Total: <strong>{formatIdr(programsTotal + equipmentTotal)}</strong> (rincian perlengkapan di
              langkah pembayaran)
            </Typography>
          </>
        ) : null}
      </Alert>
    </Box>
  )
}
