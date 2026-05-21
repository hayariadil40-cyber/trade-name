import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  // Verifica JWT
  const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const { base64, path, contentType } = await req.json()
  if (!base64 || !path) return new Response(JSON.stringify({ error: 'Missing base64 or path' }), { status: 400 })

  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

  const { error: upErr } = await supabase.storage
    .from('trade-screenshots')
    .upload(path, bytes, { contentType: contentType || 'image/jpeg', upsert: true })

  if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500 })

  const { data: { publicUrl } } = supabase.storage.from('trade-screenshots').getPublicUrl(path)

  return new Response(JSON.stringify({ publicUrl }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
