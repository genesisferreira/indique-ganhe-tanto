"use client"

import { PageHeader } from "@/components/ui/page-header"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { INDICADOR_FAQ_ITEMS } from "@/lib/indicador-faq"

export default function IndicadorDuvidasPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Central de Dúvidas"
        description="Tire as principais dúvidas sobre indicações, planos, recompensas e saques."
      />

      <div className="rounded-xl border bg-card px-4 sm:px-6">
        <Accordion type="single" collapsible className="w-full">
          {INDICADOR_FAQ_ITEMS.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger className="text-left text-base hover:no-underline">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  )
}
