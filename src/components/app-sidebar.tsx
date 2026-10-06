import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  LineChart,
  Briefcase,
  Brain,
  Trophy,
  BookOpen,
  Settings,
  ShieldCheck,
  LogOut,
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const main = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Trading", url: "/trading", icon: LineChart },
  { title: "Portfolio", url: "/portfolio", icon: Briefcase },
];
const insights = [
  { title: "Behavioral", url: "/behavioral", icon: Brain },
  { title: "Gamification", url: "/gamification", icon: Trophy },
];
const learn = [
  { title: "User Guide", url: "/docs", icon: BookOpen },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => (u === "/" ? path === "/" : path.startsWith(u));
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();

  const Section = ({ label, items }: { label: string; items: typeof main }) => (
    <SidebarGroup>
      <SidebarGroupLabel className="small-caps text-[0.65rem]">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url} className="flex items-center gap-2.5">
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  const metadata = user?.user_metadata as { display_name?: string } | undefined;
  const displayName = metadata?.display_name ?? user?.email?.split("@")[0] ?? "Guest";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-sidebar-border px-3 py-4">
        <Link to="/" className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-white/70 bg-white text-primary shadow-[0_10px_24px_oklch(0.2_0.08_245_/_0.22)] font-serif text-xl font-semibold leading-none">
            I
          </div>
          <div className="leading-tight">
            <div className="font-serif text-lg font-semibold text-white drop-shadow-sm">
              FinSight
            </div>
            <div className="small-caps text-[0.6rem] text-white/80">
              v1.0 - Research group
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <Section label="Workspace" items={main} />
        <Section label="Insights" items={insights} />
        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel className="small-caps text-[0.65rem]">Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/admin")}>
                    <Link to="/admin" className="flex items-center gap-2.5">
                      <ShieldCheck className="h-4 w-4" />
                      <span>User Oversight</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <Section label="Resources" items={learn} />
      </SidebarContent>
      <SidebarFooter className="border-sidebar-border space-y-2 border-t p-3">
        <div className="rounded-lg border border-white/25 bg-white/14 p-2.5 shadow-[0_10px_28px_oklch(0.2_0.08_245_/_0.18)] backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full border border-white/70 bg-white text-primary text-xs font-bold shadow-sm">
              {initials}
            </div>
            <div className="text-xs leading-tight flex-1 min-w-0">
              <div className="truncate font-semibold text-white">{displayName}</div>
              <div className="capitalize text-white/78">{role ?? "user"}</div>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2 text-white hover:bg-white/16 hover:text-white"
          onClick={async () => {
            await signOut();
            navigate({ to: "/auth" });
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
