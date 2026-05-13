import { type NextRequest, NextResponse } from 'next/server'
import { logAuthAudit } from '@/lib/auth/auth-audit'
// import { updateSession } from '@/lib/supabase/middleware'

// Define route permissions
const routePermissions: Record<string, string[]> = {
  '/indicador': ['indicador'],
  '/comercial': ['comercial'],
  '/admin': ['admin_consulta', 'admin_financeiro', 'admin_master'],
}

// Public routes that don't require authentication
const publicRoutes = [
  '/',
  '/login',
  '/cadastro',
  '/recuperar-senha',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (publicRoutes.some(route => pathname === route || pathname.startsWith('/_next') || pathname.startsWith('/api'))) {
    return NextResponse.next()
  }

  const protectedRouteMatch = Object.keys(routePermissions).find((route) =>
    pathname.startsWith(route)
  )
  if (process.env.NODE_ENV === 'development' && protectedRouteMatch) {
    logAuthAudit({
      role: null,
      route: pathname,
      allowed: true,
      reason:
        'middleware(dev): bypass de autenticação; enforcement no cliente (AuthenticatedDashboardShell) + RLS',
    })
  }

  // TODO: Enable when Supabase is connected
  // const { supabaseResponse, user } = await updateSession(request)
  
  // Autenticação por rota: em produção habilitar `updateSession` + checagem de role abaixo.
  // Hoje a coerência role × área é aplicada no cliente (`AuthenticatedDashboardShell` + RLS no Supabase).
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }

  // Check if route requires authentication
  const protectedRoute = Object.keys(routePermissions).find(route => 
    pathname.startsWith(route)
  )

  if (!protectedRoute) {
    return NextResponse.next()
  }

  // TODO: Uncomment when Supabase is connected
  /*
  // Check if user is authenticated
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Get user role from metadata or profile
  const userRole = user.user_metadata?.role || 'indicador'
  const allowedRoles = routePermissions[protectedRoute]

  // Check if user has permission
  if (!allowedRoles.includes(userRole)) {
    // Redirect to appropriate dashboard based on role
    const redirectMap: Record<string, string> = {
      'indicador': '/indicador',
      'comercial': '/comercial',
      'admin_consulta': '/admin',
      'admin_financeiro': '/admin',
      'admin_master': '/admin',
    }
    return NextResponse.redirect(new URL(redirectMap[userRole] || '/', request.url))
  }

  return supabaseResponse
  */

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
