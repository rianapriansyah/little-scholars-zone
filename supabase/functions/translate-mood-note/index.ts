/// <reference path="./deno-shim.d.ts" />
// Deploy: supabase functions deploy translate-mood-note
//
// Rewrites a teacher's raw Suasana Hati note (mood_note) into a warmer, parent-appropriate
// version. Pure text transform — no database access, so no Supabase admin client here. The
// caller (DailyReportStudentDialog) shows the result to the teacher for review/editing before
// it is ever saved as daily_reports.mood_note_parent; this function never writes to the DB.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MOOD_LABELS: Record<string, string> = {
  senang: 'senang',
  biasa: 'biasa saja',
  sedih: 'sedih',
}

const MAX_NOTE_LENGTH = 1000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type OpenAIChatResponse = {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or invalid Authorization' }, 401)
    }

    // Decode JWT inline — no extra HTTP round-trip. Same pattern as create-teacher-account.
    const token = authHeader.slice('Bearer '.length).trim()
    let jwtPayload: Record<string, unknown>
    try {
      const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      jwtPayload = JSON.parse(atob(payloadB64)) as Record<string, unknown>
    } catch {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const exp = jwtPayload['exp'] as number | undefined
    if (!exp || Math.floor(Date.now() / 1000) > exp) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    // Teacher or admin only — this endpoint exists to help a teacher fill in a report, not for
    // parent or anonymous use.
    const appMeta = jwtPayload['app_metadata'] as Record<string, unknown> | undefined
    const role = appMeta?.['role']
    if (role !== 'teacher' && role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
    if (!apiKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500)
    }

    const body = (await req.json()) as { mood?: unknown; note?: unknown }
    const mood = typeof body.mood === 'string' ? body.mood : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    if (!MOOD_LABELS[mood]) {
      return jsonResponse({ error: 'mood must be senang, biasa, or sedih' }, 400)
    }
    if (!note) {
      return jsonResponse({ error: 'note is required' }, 400)
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return jsonResponse({ error: `note must be ${MAX_NOTE_LENGTH} characters or fewer` }, 400)
    }

    const systemPrompt =
      'Kamu membantu seorang guru PAUD menuliskan ulang catatan singkat tentang suasana hati ' +
      'seorang anak, dari versi cepat/informal untuk dirinya sendiri menjadi versi yang akan ' +
      'dibaca langsung oleh orang tua anak tersebut. Tulis dalam Bahasa Indonesia, hangat, ' +
      'jujur, dan menenangkan — jangan menambahkan detail, kejadian, atau penjelasan yang ' +
      'tidak ada di catatan asli. Jangan melebih-lebihkan maupun meremehkan apa yang terjadi. ' +
      'Balas HANYA dengan catatan yang sudah ditulis ulang, tanpa salam pembuka, tanpa tanda ' +
      'kutip, dan tanpa komentar tambahan.'

    const userPrompt =
      `Suasana hati anak hari ini: ${MOOD_LABELS[mood]}.\n` +
      `Catatan guru (untuk dirinya sendiri): "${note}"\n\n` +
      'Tulis ulang catatan ini untuk orang tua.'

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 300,
      }),
    })

    const data = (await openaiResponse.json()) as OpenAIChatResponse

    if (!openaiResponse.ok) {
      console.error('OpenAI error:', data.error?.message ?? openaiResponse.status)
      return jsonResponse({ error: 'Gagal menerjemahkan catatan. Coba lagi.' }, 502)
    }

    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) {
      return jsonResponse({ error: 'Gagal menerjemahkan catatan. Coba lagi.' }, 502)
    }

    return jsonResponse({ text })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error'
    console.error('Unhandled exception:', message)
    return jsonResponse({ error: message }, 500)
  }
})
