import { Toaster } from "sonner"
import { IndicadorHomeProvider } from "./indicador-home-provider"

export default function IndicadorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <IndicadorHomeProvider>{children}</IndicadorHomeProvider>
      <Toaster richColors closeButton />
    </>
  )
}
