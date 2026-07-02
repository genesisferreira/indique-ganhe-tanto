import { type NextRequest, NextResponse } from "next/server"
import {
  evaluateRouteAccessForRole,
  getDashboardHomeForRole,
  logAuthAudit,
} from "@/lib/auth/auth-audit"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { updateSession } from "@/lib/supabase/middleware"
import type { UserRole } from "@/types/user"

const protectedPrefixes = ["/indicador", "/comercial", "/admin", "/notificacoes"]

const publicRoutes = [
  "/",
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/auth/logout",
]

function isPublicPath(pathname: string): boolean {
  if (publicRoutes.some((route) => pathname === route)) return true
  if (pathname.startsWith("/auth/")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/api")) return true
  return false
}

function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

function redirectToLogin(request: NextRequest, pathname: string): NextResponse {
  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("redirect", pathname)
  return applyNoStoreHeaders(NextResponse.redirect(loginUrl))
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
    return redirectToLogin(request, pathname)
  }

  const { supabaseResponse, user, supabase } = await updateSession(request)

  if (!user) {
    return redirectToLogin(request, pathname)
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  const role = (profileRow?.role ?? null) as UserRole | null

  if (profileError || !role) {
    return redirectToLogin(request, pathname)
  }

  const access = evaluateRouteAccessForRole(pathname, role)
  if (!access.allowed) {
    const redirectUrl = new URL(getDashboardHomeForRole(role), request.url)
    return applyNoStoreHeaders(NextResponse.redirect(redirectUrl))
  }

  return applyNoStoreHeaders(supabaseResponse)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
