// app/api/admin/providers/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req)
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('providers')
    .select('id, created_at, name, email, phone, active, skills, rating, total_jobs, notes', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status === 'active') query = query.eq('active', true)
  if (status === 'inactive') query = query.eq('active', false)
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ providers: data, total: count })
}

export async function PATCH(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const allowed = ['active', 'notes', 'skills']
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('providers')
    .update(filtered)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'update_provider', 'provider', id, filtered)
  return NextResponse.json({ provider: data })
}
