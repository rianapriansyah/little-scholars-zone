import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import {
  REGISTRATION_STEPS,
  emptyDraft,
  toSubmitPayload,
  validateStep,
  type DraftChild,
  type ProgramOption,
  type RegistrationDraft,
} from '../../lib/registrationDraft'
import { fetchPublicPrograms, receiptMetaFromFile, submitRegistration } from '../../lib/registration'
import { buildWhatsAppMeUrl } from '../../lib/whatsappLink'
import { todayIsoDateInWita } from '../../lib/classStatus'
import { ParentsStep } from './ParentsStep'
import { ChildrenStep } from './ChildrenStep'
import { ProgramsStep } from './ProgramsStep'
import { PaymentStep } from './PaymentStep'
import { ReviewStep } from './ReviewStep'

const DRAFT_STORAGE_KEY = 'lsz_registration_draft_v1'
// Kept out of featureFlags.ts on purpose — see the TODO in PaymentStep.tsx for what to fill in
// before this can be a real number, and what to do once it is.
const CENTER_WHATSAPP_NUMBER: string | null = null

function loadStoredDraft(fallback: RegistrationDraft): RegistrationDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as RegistrationDraft
    if (!parsed || !Array.isArray(parsed.children) || parsed.children.length === 0) return fallback
    return parsed
  } catch {
    return fallback
  }
}

export function RegisterWizardPage() {
  const [draft, setDraft] = useState<RegistrationDraft>(() => loadStoredDraft(emptyDraft(crypto.randomUUID())))
  const [step, setStep] = useState(0)
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [programsLoading, setProgramsLoading] = useState(true)
  const [programsError, setProgramsError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [referenceCode, setReferenceCode] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setProgramsLoading(true)
      const result = await fetchPublicPrograms()
      setProgramsLoading(false)
      if (!result.ok) {
        setProgramsError(result.error)
        return
      }
      setPrograms(result.data)
    })()
  }, [])

  // The file itself is not JSON-serializable and should not outlive the tab anyway, so only
  // the form fields survive a refresh.
  useEffect(() => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [draft])

  function patchDraft(patch: Partial<RegistrationDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  function setChildren(children: DraftChild[]) {
    patchDraft({ children })
  }

  const today = todayIsoDateInWita()
  const receiptMeta = receipt ? receiptMetaFromFile(receipt) : null

  function handleNext() {
    const message = validateStep(step, draft, programs, receiptMeta, today)
    if (message) {
      setError(message)
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, REGISTRATION_STEPS.length - 1))
  }

  function handleBack() {
    setError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function handleSubmit() {
    const message = validateStep(4, draft, programs, receiptMeta, today)
    if (message || !receipt) {
      setError(message ?? 'Unggah bukti pembayaran.')
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await submitRegistration(toSubmitPayload(draft), receipt)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setReferenceCode(result.data.referenceCode)
  }

  const waUrl = buildWhatsAppMeUrl(CENTER_WHATSAPP_NUMBER)

  if (referenceCode) {
    return (
      <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" gutterBottom>Pendaftaran Terkirim</Typography>
          <Alert severity="success" sx={{ mb: 2 }}>
            Kode Referensi Anda: <strong>{referenceCode}</strong>
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Simpan kode ini. Admin akan memverifikasi pembayaran dan menghubungi Anda melalui WhatsApp begitu
            pendaftaran disetujui.
          </Typography>
          {waUrl ? (
            <Button variant="outlined" color="success" startIcon={<WhatsAppIcon />} fullWidth href={waUrl} target="_blank" rel="noopener noreferrer">
              Hubungi Kami
            </Button>
          ) : null}
          <Button component={RouterLink} to="/login" variant="text" fullWidth sx={{ mt: 2 }}>
            Kembali ke Halaman Masuk
          </Button>
        </Paper>
      </Container>
    )
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Container maxWidth="sm" sx={{ mt: { xs: 2, sm: 4, md: 8 }, mb: 4, px: { xs: 2, sm: 3 } }}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" gutterBottom>Pendaftaran Orang Tua Baru</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sudah punya akun?{' '}
            <Link component={RouterLink} to="/login">Masuk di sini</Link>
          </Typography>

          <Stepper activeStep={step} sx={{ mb: 3, display: { xs: 'none', sm: 'flex' } }}>
            {REGISTRATION_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          <Typography variant="subtitle1" sx={{ mb: 2, display: { sm: 'none' } }}>
            Langkah {step + 1}/{REGISTRATION_STEPS.length}: {REGISTRATION_STEPS[step]}
          </Typography>

          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}

          {programsLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : programsError ? (
            <Alert severity="error">{programsError}</Alert>
          ) : (
            <>
              {step === 0 ? <ParentsStep draft={draft} onChange={patchDraft} /> : null}
              {step === 1 ? <ChildrenStep children={draft.children} onChange={setChildren} /> : null}
              {step === 2 ? (
                <ProgramsStep children={draft.children} programs={programs} onChange={setChildren} />
              ) : null}
              {step === 3 ? (
                <PaymentStep
                  children={draft.children}
                  programs={programs}
                  paymentNote={draft.paymentNote}
                  receipt={receipt}
                  onReceiptChange={setReceipt}
                  onPaymentNoteChange={(paymentNote) => patchDraft({ paymentNote })}
                />
              ) : null}
              {step === 4 ? <ReviewStep draft={draft} programs={programs} receipt={receipt} /> : null}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 3 }}>
                <Button onClick={handleBack} disabled={step === 0 || submitting}>
                  Kembali
                </Button>
                {step < REGISTRATION_STEPS.length - 1 ? (
                  <Button variant="contained" onClick={handleNext} disabled={submitting}>
                    Lanjut
                  </Button>
                ) : (
                  <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting}>
                    {submitting ? 'Mengirim…' : 'Kirim Pendaftaran'}
                  </Button>
                )}
              </Box>
            </>
          )}
        </Paper>
      </Container>
    </LocalizationProvider>
  )
}
