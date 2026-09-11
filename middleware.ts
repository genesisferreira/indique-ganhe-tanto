import { type NextRequest, NextResponse } from "next/server"
import {
  evaluateRouteAccessForRole,
  getDashboardHomeForRole,
  isAllowedDuringMustChangePassword,
  isFirstAccessPath,
  isInactiveAccountPath,
  isProfileInactive,
  logAuthAudit,
} from "@/lib/auth/auth-audit"
import { FIRST_ACCESS_PATH } from "@/lib/commercial-assisted/constants"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { updateSession } from "@/lib/supabase/middleware"
import type { UserRole } from "@/types/user"

const protectedPrefixes = [
  "/indicador",
  "/comercial",
  "/funcionario",
  "/cobranca",
  "/retencao",
  "/admin",
  "/notificacoes",
  "/primeiro-acesso",
]

const publicRoutes = [
  "/",
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/atualizar-senha",
  "/conta-inativa",
  "/pre-cadastro",
  "/pre-cadastro-rede-neutra",
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
    .select("role, must_change_password, is_active")
    .eq("id", user.id)
    .maybeSingle()

  const role = (profileRow?.role ?? null) as UserRole | null
  const mustChangePassword =
    (profileRow as { must_change_password?: boolean | null } | null)
      ?.must_change_password === true
  const isActive =
    (profileRow as { is_active?: boolean | null } | null)?.is_active

  if (profileError || !role) {
    return redirectToLogin(request, pathname)
  }

  if (isProfileInactive(isActive) && !isInactiveAccountPath(pathname)) {
    const redirectUrl = new URL("/conta-inativa", request.url)
    return applyNoStoreHeaders(NextResponse.redirect(redirectUrl))
  }

  if (mustChangePassword && !isAllowedDuringMustChangePassword(pathname)) {
    const redirectUrl = new URL(FIRST_ACCESS_PATH, request.url)
    return applyNoStoreHeaders(NextResponse.redirect(redirectUrl))
  }

  if (!mustChangePassword && isFirstAccessPath(pathname)) {
    const redirectUrl = new URL(getDashboardHomeForRole(role), request.url)
    return applyNoStoreHeaders(NextResponse.redirect(redirectUrl))
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
