import Image from "next/image"
import { cn } from "@/lib/utils"

export type TantoBrandVariant = "symbol" | "full"
export type TantoBrandSize = "sm" | "md" | "lg" | "xl"

export type TantoBrandProps = {
  variant?: TantoBrandVariant
  size?: TantoBrandSize
  className?: string
  priority?: boolean
}

const SYMBOL_PX: Record<TantoBrandSize, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
}

const SYMBOL_CLASS: Record<TantoBrandSize, string> = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
}

const FULL_PX: Record<TantoBrandSize, { width: number; height: number }> = {
  sm: { width: 120, height: 36 },
  md: { width: 160, height: 48 },
  lg: { width: 220, height: 64 },
  xl: { width: 300, height: 88 },
}

const FULL_CLASS: Record<TantoBrandSize, string> = {
  sm: "h-9 w-auto max-w-[120px]",
  md: "h-12 w-auto max-w-[160px]",
  lg: "h-16 w-auto max-w-[220px]",
  xl: "h-20 w-auto max-w-[300px]",
}

export function TantoBrand({
  variant = "symbol",
  size = "md",
  className,
  priority = false,
}: TantoBrandProps) {
  if (variant === "full") {
    const { width, height } = FULL_PX[size]
    return (
      <Image
        src="/branding/tanto-logo.png"
        alt="Tanto Telecom"
        width={width}
        height={height}
        priority={priority}
        className={cn("object-contain object-left", FULL_CLASS[size], className)}
      />
    )
  }

  const px = SYMBOL_PX[size]
  return (
    <Image
      src="/branding/tanto-symbol.png"
      alt="Símbolo Tanto Telecom"
      width={px}
      height={px}
      priority={priority}
      className={cn(
        "object-contain shrink-0",
        SYMBOL_CLASS[size],
        className
      )}
    />
  )
}
