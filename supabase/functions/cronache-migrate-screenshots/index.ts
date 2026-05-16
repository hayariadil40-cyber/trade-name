import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (_req) => {
  const { data: cronache, error } = await supabase
    .from('cronache')
    .select('id, coin_data')
    .not('coin_data', 'is', null)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let migrated = 0
  let skipped = 0
  const errors: string[] = []

  for (const cronaca of cronache || []) {
    if (!cronaca.coin_data) { skipped++; continue }

    let changed = false
    const newCoinData: Record<string, unknown> = { ...cronaca.coin_data }

    for (const [coin, data] of Object.entries(newCoinData)) {
      const coinObj = data as Record<string, unknown>
      const screenshot = coinObj?.screenshot as string
      if (!screenshot?.startsWith('data:image')) continue

      const match = screenshot.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!match) continue

      const mimeType = match[1]
      const ext = mimeType === 'jpeg' ? 'jpg' : mimeType
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))
      const path = `cronache/${cronaca.id}/${coin}_migrated.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('trade-screenshots')
        .upload(path, bytes, { contentType: `image/${mimeType}`, upsert: true })

      if (uploadErr) {
        errors.push(`${cronaca.id}/${coin}: ${uploadErr.message}`)
        continue
      }

      const { data: { publicUrl } } = supabase.storage
        .from('trade-screenshots')
        .getPublicUrl(path)

      newCoinData[coin] = { ...coinObj, screenshot: publicUrl }
      changed = true
    }

    if (changed) {
      const { error: updateErr } = await supabase
        .from('cronache')
        .update({ coin_data: newCoinData })
        .eq('id', cronaca.id)

      if (updateErr) errors.push(`update ${cronaca.id}: ${updateErr.message}`)
      else migrated++
    } else {
      skipped++
    }
  }

  return new Response(
    JSON.stringify({ migrated, skipped, errors, total: (cronache || []).length }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
