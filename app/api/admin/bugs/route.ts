// app/api/admin/bugs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix']

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'open'
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('bugs')
    .select('id, created_at, title, description, status, priority, reporter_email, notes', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status !== 'all') query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ bugs: data, total: count })
}

export async function POST(req: NextRequest) {
  // Public bug report -- no auth required
  const { title, description, reporter_email, priority } = await req.json()
  if (!title || !description) {
    return NextResponse.json({ error: 'title and description required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bugs')
    .insert({
      title,
      description,
      reporter_email: reporter_email ?? null,
      priority: priority ?? 'medium',
      status: 'open',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bug: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const { id, status, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Use: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const updates: Record<string, any> = {}
  if (status) updates.status = status
  if (notes !== undefined) updates.notes = notes

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bugs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'update_bug', 'bug', id, updates)
  return NextResponse.json({ bug: data })
}
