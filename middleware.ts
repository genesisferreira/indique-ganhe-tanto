import { type NextRequest, NextResponse } from "next/server"
import {
  evaluateRouteAccessForRole,
  getDashboardHomeForRole,
  logAuthAudit,
} from "@/lib/auth/auth-audit"
import { updateSession } from "@/lib/supabase/middleware"
import type { UserRole } from "@/types/user"

const protectedPrefixes = ["/indicador", "/comercial", "/admin", "/notificacoes"]

const publicRoutes = ["/", "/login", "/cadastro", "/recuperar-senha"]

function isPublicPath(pathname: string): boolean {
  if (publicRoutes.some((route) => pathname === route)) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/api")) return true
  return false
}

function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const protectedRoute = isProtectedPath(pathname)

  if (process.env.NODE_ENV === "development") {
    if (protectedRoute) {
      logAuthAudit({
        role: null,
        route: pathname,
        allowed: true,
        reason:
          "middleware(dev): bypass; enforcement no cliente (AuthenticatedDashboardShell) + RLS",
      })
    }
    return NextResponse.next()
  }

  if (!protectedRoute) {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!supabaseUrl || !supabaseAnonKey) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { supabaseResponse, user, supabase } = await updateSession(request)

  if (!user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  const role = (profileRow?.role ?? null) as UserRole | null

  if (profileError || !role) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirect", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const access = evaluateRouteAccessForRole(pathname, role)
  if (!access.allowed) {
    const redirectUrl = new URL(getDashboardHomeForRole(role), request.url)
    return NextResponse.redirect(redirectUrl)
  }

  supabaseResponse.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate"
  )

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
