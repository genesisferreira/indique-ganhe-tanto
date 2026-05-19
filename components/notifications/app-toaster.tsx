"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Toaster } from "sonner"

type AppToasterProps = {
  variant?: "indicador" | "comercial" | "admin"
}

/**
 * Toaster em portal no body — evita stacking context do sidebar/mobile header.
 * Indicador usa offset maior no mobile (header fixo z-50).
 */
export function AppToaster({ variant }: AppToasterProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || process.env.NODE_ENV !== "development") return

    console.log("[toast:render]", { variant, mounted: true })

    const logDom = () => {
      const el = document.querySelector("[data-sonner-toaster]")
      const style = el ? getComputedStyle(el as Element) : null
      const isMobile = window.matchMedia("(max-width: 1023px)").matches

      console.log("[toast:dom]", {
        variant,
        found: Boolean(el),
        zIndex: style?.zIndex ?? null,
        position: style?.position ?? null,
        top: style?.top ?? null,
        pointerEvents: style?.pointerEvents ?? null,
      })

      console.log("[toast:mobile]", {
        variant,
        isMobile,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      })

      if (variant === "indicador") {
        console.log("[toast:indicator]", {
          toasterInDom: Boolean(el),
          toastCount: document.querySelectorAll("[data-sonner-toast]").length,
        })
      }
    }

    logDom()
    const t = window.setTimeout(logDom, 500)
    return () => window.clearTimeout(t)
  }, [mounted, variant])

  if (!mounted || typeof document === "undefined") {
    return null
  }

  const isIndicador = variant === "indicador"

  return createPortal(
    <Toaster
      richColors
      closeButton
      position="top-right"
      expand
      visibleToasts={5}
      duration={6000}
      offset={isIndicador ? 20 : 16}
      mobileOffset={
        isIndicador
          ? { top: "4.75rem", right: "0.75rem", left: "0.75rem" }
          : { top: "1rem", right: "0.75rem", left: "0.75rem" }
      }
      toastOptions={{
        style: { zIndex: 999999 },
      }}
      style={{ zIndex: 999999 }}
      className="pointer-events-none [&_[data-sonner-toast]]:pointer-events-auto"
    />,
    document.body
  )
}
