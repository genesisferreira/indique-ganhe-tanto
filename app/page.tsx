import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Zap,
  Gift,
  Users,
  Wallet,
  ArrowRight,
  CheckCircle2,
  Star,
  TrendingUp,
} from "lucide-react"

const benefits = [
  {
    icon: Gift,
    title: "Recompensas Atrativas",
    description:
      "Ganhe o valor da primeira mensalidade do plano escolhido pelo seu indicado.",
  },
  {
    icon: Wallet,
    title: "Pix ou Desconto",
    description:
      "Escolha receber via Pix ou como desconto na sua próxima fatura.",
  },
  {
    icon: Users,
    title: "Indicações Ilimitadas",
    description:
      "Indique quantas pessoas quiser. Quanto mais indicar, mais você ganha!",
  },
  {
    icon: TrendingUp,
    title: "Acompanhe Tudo",
    description:
      "Dashboard completo para acompanhar suas indicações e ganhos em tempo real.",
  },
]

const steps = [
  {
    number: "01",
    title: "Cadastre-se",
    description: "Crie sua conta gratuitamente em poucos minutos.",
  },
  {
    number: "02",
    title: "Indique",
    description: "Cadastre os dados do seu amigo ou familiar.",
  },
  {
    number: "03",
    title: "Aguarde",
    description: "Nossa equipe entrará em contato com o indicado.",
  },
  {
    number: "04",
    title: "Receba",
    description: "Após o pagamento da primeira fatura, receba sua recompensa!",
  },
]

const testimonials = [
  {
    name: "Maria Silva",
    role: "Indicadora desde 2023",
    content:
      "Já indiquei mais de 20 pessoas e recebi todas as recompensas certinho. Super recomendo!",
    rating: 5,
  },
  {
    name: "João Santos",
    role: "Indicador desde 2024",
    content:
      "Processo muito simples e pagamento rápido. A Tanto Telecom é confiável.",
    rating: 5,
  },
  {
    name: "Ana Oliveira",
    role: "Indicadora desde 2024",
    content:
      "Adoro o desconto na fatura! Já não pago internet há meses.",
    rating: 5,
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold text-foreground">Tanto Telecom</span>
              <span className="block text-xs text-muted-foreground">
                Indique e Ganhe
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild>
              <Link href="/cadastro">Cadastrar</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
        <div className="container relative mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 text-sm font-medium rounded-full bg-primary/10 text-primary border border-primary/20">
              <Gift className="w-4 h-4" />
              Programa de Indicações
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
              Indique amigos e{" "}
              <span className="text-primary">ganhe recompensas</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
              Participe do programa Indique e Ganhe da Tanto Telecom. A cada
              indicação convertida, você recebe o valor da primeira mensalidade
              do plano escolhido.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
              <Button size="lg" asChild className="w-full sm:w-auto">
                <Link href="/cadastro">
                  Começar Agora
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="w-full sm:w-auto"
              >
                <Link href="/login">Já tenho conta</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-card/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">
              Por que participar?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Vantagens exclusivas para quem indica
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="p-6 rounded-2xl bg-card border border-border hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
                  <benefit.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {benefit.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {benefit.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">
              Como funciona?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Simples e rápido em 4 passos
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                <div className="text-6xl font-bold text-primary/20 mb-4">
                  {step.number}
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {step.title}
                </h3>
                <p className="text-muted-foreground">{step.description}</p>
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 right-0 translate-x-1/2 w-16 border-t-2 border-dashed border-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-card/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">
              O que dizem nossos indicadores
            </h2>
            <p className="mt-3 text-muted-foreground">
              Histórias de sucesso do programa
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="p-6 rounded-2xl bg-card border border-border"
              >
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star
                      key={i}
                      className="w-4 h-4 fill-primary text-primary"
                    />
                  ))}
                </div>
                <p className="text-foreground mb-4">
                  &ldquo;{testimonial.content}&rdquo;
                </p>
                <div>
                  <p className="font-semibold text-foreground">
                    {testimonial.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-3xl bg-primary p-8 lg:p-16">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-primary-foreground/10 via-transparent to-transparent" />
            <div className="relative max-w-2xl">
              <h2 className="text-3xl font-bold text-primary-foreground lg:text-4xl text-balance">
                Pronto para começar a ganhar?
              </h2>
              <p className="mt-4 text-primary-foreground/80">
                Cadastre-se agora e comece a indicar. É grátis, simples e
                rápido.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  variant="secondary"
                  asChild
                  className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                >
                  <Link href="/cadastro">
                    Criar Conta Grátis
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
              <div className="mt-6 flex items-center gap-6 text-sm text-primary-foreground/80">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Cadastro gratuito
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Pagamento garantido
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">
                Tanto Telecom
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              2024 Tanto Telecom. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
