import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTradingStore } from "@/lib/store";
import { formatVnd } from "@/lib/currency";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings - FinSight" }] }),
  component: Settings,
});

function Settings() {
  const { user, role } = useAuth();
  const cash = useTradingStore((s) => s.cash);
  const feeRate = useTradingStore((s) => s.feeRate);
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);
  const displayName =
    (user?.user_metadata as any)?.display_name ?? user?.email?.split("@")[0] ?? "";

  return (
    <>
      <PageHeader
        eyebrow="Account - Preferences"
        title="Settings"
        description="Your account and simulation settings are shown from the active session."
      />
      <PageBody>
        <Card className="p-6">
          <h3 className="font-serif text-lg font-semibold">Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
            <Field label="Display name" value={displayName} />
            <Field label="Email" value={user?.email ?? ""} />
            <Field label="User ID" value={user?.id ?? ""} mono />
            <Field label="Role" value={role ?? "user"} />
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-serif text-lg font-semibold">Simulation</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
            <Field label="Cash available" value={formatVnd(cash, 2)} mono />
            <Field label="Trading fee (bps)" value={(feeRate * 10000).toFixed(1)} mono />
            <Field label="Open positions" value={String(positions.length)} mono />
            <Field label="Executed trades" value={String(history.length)} mono />
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-serif text-lg font-semibold mb-4">Behavioral feedback</h3>
          <Toggle
            label="Real-time bias alerts"
            desc="Notify when a cognitive bias is detected during trading."
            defaultChecked
          />
          <Toggle label="Cool-down lock" desc="Lock trading after repeated high-risk trades." />
          <Toggle
            label="Anonymized data export"
            desc="Allow aggregate behavior data to be used for research."
            defaultChecked
          />
        </Card>

        <Card className="p-6">
          <h3 className="font-serif text-lg font-semibold mb-4">Data sources</h3>
          {["Supabase Auth", "Supabase Database", "Simulation market data"].map((source) => (
            <div
              key={source}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div>
                <div className="font-medium text-sm">{source}</div>
                <div className="text-xs text-muted-foreground">
                  Connected to the active project configuration
                </div>
              </div>
              <Button variant="outline" size="sm" disabled>
                Connected
              </Button>
            </div>
          ))}
        </Card>
      </PageBody>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label className="small-caps text-[0.65rem] text-muted-foreground">{label}</label>
      <Input value={value} readOnly className={mono ? "font-mono" : ""} />
    </div>
  );
}

function Toggle({
  label,
  desc,
  defaultChecked,
}: {
  label: string;
  desc: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b last:border-0">
      <div className="pr-4">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}
