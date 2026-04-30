"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Home,
  Users,
  UserPlus,
  Wallet,
  Receipt,
  FileText,
  Key,
  User,
  BarChart3,
  Clock,
  History,
  Gauge,
  Settings,
  CreditCard,
  Upload,
  Shield,
  Building2,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const indicadorNav: NavGroup[] = [
  {
    title: "Principal",
    items: [
      { label: "Dashboard", href: "/indicador", icon: Home },
      { label: "Nova Indicação", href: "/indicador/nova-indicacao", icon: UserPlus },
      { label: "Minhas Indicações", href: "/indicador/indicacoes", icon: Users },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { label: "Minha Carteira", href: "/indicador/carteira", icon: Wallet },
      { label: "Meus Pagamentos", href: "/indicador/pagamentos", icon: Receipt },
      { label: "Meus Comprovantes", href: "/indicador/comprovantes", icon: FileText },
    ],
  },
  {
    title: "Configurações",
    items: [
      { label: "Minha Chave Pix", href: "/indicador/chave-pix", icon: Key },
      { label: "Meu Perfil", href: "/indicador/perfil", icon: User },
    ],
  },
]

const comercialNav: NavGroup[] = [
  {
    title: "Principal",
    items: [
      { label: "Dashboard", href: "/comercial", icon: Home },
      { label: "Meus Leads", href: "/comercial/leads", icon: Users, badge: 5 },
      { label: "Retornos Agendados", href: "/comercial/retornos", icon: Clock, badge: 3 },
    ],
  },
  {
    title: "Histórico",
    items: [
      { label: "Atendimentos", href: "/comercial/historico", icon: History },
      { label: "Meu Desempenho", href: "/comercial/desempenho", icon: BarChart3 },
    ],
  },
  {
    title: "Configurações",
    items: [
      { label: "Disponibilidade", href: "/comercial/disponibilidade", icon: Gauge },
      { label: "Meu Perfil", href: "/comercial/perfil", icon: User },
    ],
  },
]

const adminNav: NavGroup[] = [
  {
    title: "Principal",
    items: [
      { label: "Dashboard", href: "/admin", icon: Home },
      { label: "Indicações", href: "/admin/indicacoes", icon: Users },
      { label: "Indicadores", href: "/admin/indicadores", icon: UserPlus },
    ],
  },
  {
    title: "Equipe",
    items: [
      { label: "Comerciais", href: "/admin/comerciais", icon: Building2 },
      { label: "Administradores", href: "/admin/admins", icon: Shield },
      { label: "Planos", href: "/admin/planos", icon: Zap },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { label: "Recompensas", href: "/admin/financeiro", icon: Wallet },
      { label: "Pagamentos Pendentes", href: "/admin/pagamentos-pendentes", icon: CreditCard, badge: 4 },
      { label: "Histórico Pagamentos", href: "/admin/historico-pagamentos", icon: History },
      { label: "Upload Comprovante", href: "/admin/upload-comprovante", icon: Upload },
    ],
  },
  {
    title: "Relatórios",
    items: [
      { label: "Relatórios", href: "/admin/relatorios", icon: BarChart3 },
      { label: "Auditoria", href: "/admin/auditoria", icon: FileText },
      { label: "Configurações", href: "/admin/configuracoes", icon: Settings },
    ],
  },
]

interface SidebarProps {
  variant: "indicador" | "comercial" | "admin"
  userName: string
  userRole: string
}

export function Sidebar({ variant, userName, userRole }: SidebarProps) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  const navigation =
    variant === "indicador"
      ? indicadorNav
      : variant === "comercial"
        ? comercialNav
        : adminNav

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-sidebar border-b border-sidebar-border lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">Tanto Telecom</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(!isOpen)}
          className="text-foreground"
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex flex-col w-64 h-full bg-sidebar border-r border-sidebar-border transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-foreground">Tanto Telecom</h1>
            <p className="text-xs text-muted-foreground">Indique e Ganhe</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
          {navigation.map((group) => (
            <div key={group.title}>
              <h2 className="px-3 mb-2 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                {group.title}
              </h2>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-primary"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                      >
                        <item.icon className="w-5 h-5" />
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span className="flex items-center justify-center w-5 h-5 text-xs font-semibold rounded-full bg-primary text-primary-foreground">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User Menu */}
        <div className="p-3 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center w-full gap-3 p-3 rounded-lg hover:bg-sidebar-accent transition-colors">
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground truncate">
                    {userName}
                  </p>
                  <p className="text-xs text-muted-foreground">{userRole}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link href={`/${variant}/perfil`}>
                  <User className="w-4 h-4 mr-2" />
                  Meu Perfil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/login" className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sair
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  )
}
