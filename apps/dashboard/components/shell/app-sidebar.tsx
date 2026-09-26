"use client"

import {
  Home,
  List,
  Radio,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"

type NavItem = {
  href: string
  icon: LucideIcon
  label: string
}

const HOUSEHOLD: NavItem[] = [
  { href: "/", icon: Home, label: "Overview" },
  { href: "/money", icon: Wallet, label: "Money" },
  { href: "/transactions", icon: List, label: "Transactions" },
]

const HOME: NavItem[] = [{ href: "/energy", icon: Zap, label: "Energy" }]

const RECORD: NavItem[] = [{ href: "/sources", icon: Radio, label: "Sources" }]

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavGroup({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isCurrent(pathname, item.href)}
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({
  email,
  isLocalPreview,
  onSignOut,
}: {
  email: string
  isLocalPreview: boolean
  onSignOut: () => void
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Household">
              <Link href="/">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold">
                  H
                </span>
                <span className="grid text-left leading-tight">
                  <span className="truncate font-semibold">Household</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Energy and money
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup items={HOUSEHOLD} label="Household" />
        <NavGroup items={HOME} label="Home" />
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <NavGroup items={RECORD} label="Record" />
        <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
          <p className="type-caption truncate">
            {isLocalPreview ? "Local preview" : email}
          </p>
          {isLocalPreview ? null : (
            <Button
              className="mt-2 w-full justify-start"
              onClick={onSignOut}
              size="sm"
              variant="ghost"
            >
              Sign out
            </Button>
          )}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
