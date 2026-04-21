// app/api/admin/roles/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

const VALID_ROLES = ['master', 'super_admin', 'admin', 'engineer'] as const

export async function GET(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin'])
  if (!admin) return adminAuthError()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('admin_roles')
    .select('id, user_id, role, notes, created_at, created_by')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ roles: data })
}

export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin'])
  if (!admin) return adminAuthError()

  const { user_id, role, notes } = await req.json()
  if (!user_id || !role) return NextResponse.json({ error: 'user_id and role required' }, { status: 400 })
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Use: ${VALID_ROLES.join(', ')}` }, { status: 400 })
  }

  // Prevent non-master admins from granting master role
  if (role === 'master' && admin.role !== 'master') {
    return NextResponse.json({ error: 'Only master admins can grant master role' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('admin_roles')
    .upsert({ user_id, role, notes: notes ?? null, created_by: admin.userId }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'assign_admin_role', 'admin_roles', user_id, { role })
  return NextResponse.json({ record: data }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin'])
  if (!admin) return adminAuthError()

  const { user_id } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Prevent self-removal
  if (user_id === admin.userId) {
    return NextResponse.json({ error: 'Cannot remove your own admin role' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('admin_roles').delete().eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin.userId, 'remove_admin_role', 'admin_roles', user_id, {})
  return NextResponse.json({ success: true })
}
