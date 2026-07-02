import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

const NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate"

function loginRedirectUrl(request: NextRequest): URL {
  const url = new URL("/login", request.url)
  url.searchParams.set("loggedOut", "1")
  return url
}

async function handleLogout(request: NextRequest) {
  const redirectUrl = loginRedirectUrl(request)
  let response = NextResponse.redirect(redirectUrl)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.redirect(redirectUrl)
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    })

    await supabase.auth.signOut({ scope: "global" })
  }

  response.headers.set("Cache-Control", NO_STORE_CACHE)
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")

  return response
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}

export async function POST(request: NextRequest) {
  return handleLogout(request)
}
