import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { CredentialsRevealDialog } from '../../../components/CredentialsRevealDialog'
import { formatAge } from '../../../lib/calculateAge'
import dayjs from 'dayjs'
import { todayIsoDateInWita } from '../../../lib/classStatus'
import { createFamilyAccount } from '../../../lib/createFamilyAccount'
import { generateUniqueFamilyEmail } from '../../../lib/familyEmail'
import { formatIdr } from '../../../lib/formatIdr'
import {
  approveRegistration,
  fetchReceiptSignedUrl,
  fetchRegistrationSubmission,
  rejectRegistration,
  type RegistrationDetail,
} from '../../../lib/registration'

const STATUS_LABEL: Record<RegistrationDetail['status'], string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
}

const STATUS_COLOR: Record<RegistrationDetail['status'], 'warning' | 'success' | 'default'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'default',
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <Typography variant="body2" color="text.secondary">
      {label}: <Typography component="span" color="text.primary">{value}</Typography>
    </Typography>
  )
}

export function RegistrationDetailPage() {
  const { registrationId } = useParams<{ registrationId: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<RegistrationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

  const [startDate, setStartDate] = useState(() => todayIsoDateInWita())
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [approvedFamilyId, setApprovedFamilyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!registrationId) {
      setError('Pendaftaran tidak valid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const result = await fetchRegistrationSubmission(registrationId)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      setDetail(null)
      return
    }
    setDetail(result.data)

    const receiptResult = await fetchReceiptSignedUrl(result.data.receiptPath)
    if (receiptResult.ok) setReceiptUrl(receiptResult.data)
  }, [registrationId])

  useEffect(() => {
    void load()
  }, [load])

  const isPending = detail?.status === 'pending'
  const isPdfReceipt = detail?.receiptPath.toLowerCase().endsWith('.pdf') ?? false

  async function handleApprove() {
    if (!detail || !registrationId) return
    if (!startDate) {
      setError('Pilih tanggal mulai periode belajar.')
      return
    }
    setApproving(true)
    setError(null)

    const loginEmail = await generateUniqueFamilyEmail(detail.familyName)
    const approveResult = await approveRegistration({ submissionId: registrationId, loginEmail, startDate })
    if (!approveResult.ok) {
      setApproving(false)
      setError(approveResult.error)
      return
    }
    setApprovedFamilyId(approveResult.data.familyId)

    const accountResult = await createFamilyAccount({
      name: detail.familyName,
      email: loginEmail,
      phone: detail.contactPhone,
    })
    setApproving(false)
    if (!accountResult.ok) {
      // The family, children, and learning periods already exist at this point — only the
      // Auth login failed. Recoverable from the family page's own "Buat Info Login" button,
      // so point the admin there instead of leaving them stuck.
      setError(
        `Pendaftaran disetujui, tetapi gagal membuat info login: ${accountResult.message}. ` +
          `Buka halaman keluarga untuk membuat info login secara manual.`,
      )
      await load()
      return
    }

    setCredentials({ email: loginEmail, password: accountResult.password })
  }

  function handleCredentialsDone() {
    setCredentials(null)
    if (approvedFamilyId) {
      navigate(`/admin/families/${approvedFamilyId}`)
      return
    }
    void load()
  }

  async function handleReject() {
    if (!registrationId) return
    setRejecting(true)
    setError(null)
    const result = await rejectRegistration(registrationId, rejectReason)
    setRejecting(false)
    setRejectOpen(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRejectReason('')
    await load()
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    )
  }

  if (error && !detail) {
    return (
      <Box>
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link component={RouterLink} to="/admin/registrations" underline="hover" color="inherit">
            Pendaftaran
          </Link>
          <Typography color="text.primary">Detail</Typography>
        </Breadcrumbs>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!detail) return null

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box>
        <Breadcrumbs sx={{ mb: 1 }}>
          <Link component={RouterLink} to="/admin/registrations" underline="hover" color="inherit">
            Pendaftaran
          </Link>
          <Typography color="text.primary">Detail</Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Typography variant="h5" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
            {detail.familyName}
          </Typography>
          <Chip size="small" label={STATUS_LABEL[detail.status]} color={STATUS_COLOR[detail.status]} variant="outlined" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Kode {detail.referenceCode} · Dikirim {new Date(detail.submittedAt).toLocaleString('id-ID')}
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        {detail.status === 'rejected' && detail.rejectionReason ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Alasan penolakan: {detail.rejectionReason}
          </Alert>
        ) : null}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Orang Tua</Typography>
            <Field label="Telepon" value={detail.contactPhone} />
            <Field label="Ayah" value={[detail.fatherName, detail.fatherOccupation].filter(Boolean).join(' · ') || null} />
            <Field label="Telepon Ayah" value={detail.fatherPhone} />
            <Field label="Ibu" value={[detail.motherName, detail.motherOccupation].filter(Boolean).join(' · ') || null} />
            <Field label="Telepon Ibu" value={detail.motherPhone} />
            <Field label="Alamat" value={detail.address} />
          </Paper>

          {detail.children.map((child) => {
            const age = child.birthdate ? formatAge(dayjs(child.birthdate)) : null
            return (
              <Paper key={child.id} variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{child.fullName}</Typography>
                <Field label="Tempat, Tanggal Lahir" value={[child.birthPlace, child.birthdate].filter(Boolean).join(', ') || null} />
                {age ? <Field label="Usia" value={age} /> : null}
                <Field label="Catatan" value={child.notes} />
                <Divider sx={{ my: 1 }} />
                <Field label="Program" value={child.classroomLabel} />
                <Field label="Biaya" value={formatIdr(child.price)} />
              </Paper>
            )
          })}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Pembayaran</Typography>
            <Field label="Total" value={formatIdr(detail.amountTotal)} />
            <Field label="Catatan" value={detail.paymentNote} />
            <Box sx={{ mt: 1.5 }}>
              {receiptUrl ? (
                isPdfReceipt ? (
                  <Link href={receiptUrl} target="_blank" rel="noopener noreferrer">
                    Buka Bukti Pembayaran (PDF)
                  </Link>
                ) : (
                  <Box
                    component="img"
                    src={receiptUrl}
                    alt="Bukti pembayaran"
                    sx={{ maxWidth: '100%', maxHeight: 400, borderRadius: 1, border: 1, borderColor: 'divider' }}
                  />
                )
              ) : (
                <Typography variant="body2" color="text.secondary">Memuat bukti pembayaran…</Typography>
              )}
            </Box>
          </Paper>

          {isPending ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Tinjau</Typography>
              <TextField
                size="small"
                label="Tanggal Mulai Periode Belajar"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                fullWidth
                sx={{ mb: 2, maxWidth: 260 }}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Berlaku untuk semua anak pada pendaftaran ini."
              />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  color="error"
                  variant="outlined"
                  disabled={approving || rejecting}
                  onClick={() => setRejectOpen(true)}
                >
                  Tolak
                </Button>
                <Button
                  variant="contained"
                  disabled={approving || rejecting || !startDate}
                  onClick={() => void handleApprove()}
                >
                  {approving ? 'Memproses…' : 'Setujui'}
                </Button>
              </Box>
            </Paper>
          ) : null}
        </Box>

        {/* A dedicated dialog rather than the shared ConfirmDialog: that component is a plain
            yes/no primitive with no input slot, and rejection wants a reason field. */}
        <Dialog open={rejectOpen} onClose={() => (rejecting ? null : setRejectOpen(false))} fullWidth maxWidth="xs">
          <DialogTitle>Tolak Pendaftaran</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Pendaftaran ini akan ditandai ditolak dan tidak dapat diproses lagi.
            </Typography>
            <TextField
              size="small"
              label="Alasan Penolakan (opsional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              autoFocus
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setRejectOpen(false)} disabled={rejecting}>
              Batal
            </Button>
            <Button color="error" variant="contained" onClick={() => void handleReject()} disabled={rejecting}>
              {rejecting ? 'Memproses…' : 'Tolak'}
            </Button>
          </DialogActions>
        </Dialog>

        <CredentialsRevealDialog
          open={credentials !== null}
          name={detail.familyName}
          email={credentials?.email ?? ''}
          password={credentials?.password ?? ''}
          phone={detail.contactPhone}
          onClose={handleCredentialsDone}
        />
      </Box>
    </LocalizationProvider>
  )
}
