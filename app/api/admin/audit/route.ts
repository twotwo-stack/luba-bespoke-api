// app/api/admin/audit/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const actorId = searchParams.get('actor_id')
  const entityType = searchParams.get('entity_type')
  const action = searchParams.get('action')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') ?? '100')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('admin_audit_log')
    .select('id, created_at, actor_id, actor_email, action, entity_type, entity_id, details', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actorId) query = query.eq('actor_id', actorId)
  if (entityType) query = query.eq('entity_type', entityType)
  if (action) query = query.ilike('action', `%${action}%`)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ logs: data, total: count })
}
