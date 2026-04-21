// app/api/admin/engineering/flags/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, description, updated_at')
    .order('key')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ flags: data })
}

export async function PATCH(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'engineer'])
  if (!admin) return adminAuthError()

  const { key, enabled } = await req.json()
  if (!key || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'key and enabled (boolean) required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Flag not found' }, { status: 404 })

  await logAdminAction(admin.userId, 'toggle_feature_flag', 'feature_flag', null, { key, enabled })
  return NextResponse.json({ flag: data })
}
