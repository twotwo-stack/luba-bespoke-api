// app/api/admin/create/provider/route.ts
// Admin-assisted provider (service provider / engineer) account creation
import { NextRequest, NextResponse } from 'next/server'
import { requireBespokeAdminAuth, adminAuthError, logAdminAction } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const admin = await requireBespokeAdminAuth(req, ['master', 'super_admin', 'admin'])
  if (!admin) return adminAuthError()

  const {
    name,
    email,
    phone,
    skills,       // array of strings
    notes,
  } = await req.json()

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: provider, error } = await supabase
    .from('providers')
    .insert({
      name,
      email,
      phone: phone ?? null,
      skills: skills ?? [],
      notes: notes ?? null,
      active: true,
      rating: null,
      total_jobs: 0,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAdminAction(admin.userId, 'create_provider', 'provider', provider.id, { name, email })
  return NextResponse.json({ provider }, { status: 201 })
}
