import { Alert, Box, Divider, Paper, Typography } from '@mui/material'
import dayjs from 'dayjs'
import { formatAge } from '../../lib/calculateAge'
import { formatIdr } from '../../lib/formatIdr'
import { mandatoryFeeTotal, type FeeItemOption, type ProgramOption, type RegistrationDraft } from '../../lib/registrationDraft'
import { MandatoryFeeCard } from './MandatoryFeeCard'

type Props = {
  draft: RegistrationDraft
  programs: ProgramOption[]
  feeItems: FeeItemOption[]
  receipt: File | null
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <Typography variant="body2" color="text.secondary">
      {label}: <Typography component="span" color="text.primary">{value}</Typography>
    </Typography>
  )
}

export function ReviewStep({ draft, programs, feeItems, receipt }: Props) {
  const byId = new Map(programs.map((program) => [program.id, program]))
  const programsTotal = draft.children.reduce((sum, child) => sum + (byId.get(child.classroomId)?.price ?? 0), 0)
  const equipmentTotal = mandatoryFeeTotal(feeItems) * draft.children.length
  const total = programsTotal + equipmentTotal

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Orang Tua</Typography>
        <Row label="Nama Keluarga" value={draft.familyName} />
        <Row label="Telepon" value={draft.contactPhone} />
        <Row label="Ayah" value={[draft.fatherName, draft.fatherOccupation].filter(Boolean).join(' · ')} />
        <Row label="Ibu" value={[draft.motherName, draft.motherOccupation].filter(Boolean).join(' · ')} />
        <Row label="Alamat" value={draft.address} />
      </Paper>

      {draft.children.map((child, index) => {
        const program = byId.get(child.classroomId)
        const age = child.birthdate ? formatAge(dayjs(child.birthdate)) : null
        return (
          <Paper key={child.key} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Anak {index + 1}: {child.fullName || '—'}
            </Typography>
            <Row label="Tempat, Tanggal Lahir" value={[child.birthPlace, child.birthdate].filter(Boolean).join(', ')} />
            {age ? <Row label="Usia" value={age} /> : null}
            <Divider sx={{ my: 1 }} />
            <Row label="Program" value={program?.label ?? '—'} />
            <Row label="Biaya Program" value={program ? formatIdr(program.price) : '—'} />
            <Row label="Perlengkapan Wajib" value={formatIdr(mandatoryFeeTotal(feeItems))} />
          </Paper>
        )
      })}

      <MandatoryFeeCard feeItems={feeItems} childCount={draft.children.length} />

      <Alert severity="info">
        Biaya Program: {formatIdr(programsTotal)}
        <br />
        Perlengkapan Wajib: {formatIdr(equipmentTotal)}
        <br />
        Total Pembayaran: <strong>{formatIdr(total)}</strong>
      </Alert>

      <Typography variant="body2" color="text.secondary">
        Bukti Pembayaran: {receipt ? receipt.name : '—'}
      </Typography>

      <Alert severity="warning">
        Data akan ditinjau oleh admin sebelum akun dan kelas anak diaktifkan. Anda akan dihubungi melalui WhatsApp.
      </Alert>
    </Box>
  )
}
