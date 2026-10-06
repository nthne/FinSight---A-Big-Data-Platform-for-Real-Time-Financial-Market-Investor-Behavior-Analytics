import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in - FinSight" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { signIn, signUp, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const passwordChecks = getPasswordChecks(password, email, name);
  const passwordIsSafe = passwordChecks.every((check) => check.ok);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(formatAuthError(error));
    else toast.success("Welcome back");
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordIsSafe) {
      toast.error("Use a stronger password based on the guidance below.");
      return;
    }
    setBusy(true);
    const { error, needsEmailConfirmation } = await signUp(
      email,
      password,
      name || email.split("@")[0],
    );
    setBusy(false);
    if (error) toast.error(formatAuthError(error));
    else if (needsEmailConfirmation)
      toast.success("Account created. Check your email to confirm before signing in.");
    else toast.success("Account created. You can sign in now.");
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center font-serif text-2xl">
            I
          </div>
          <h1 className="mt-3 font-serif text-2xl font-semibold">FinSight</h1>
          <p className="text-sm text-muted-foreground">
            Investment Simulation & Behavioral Analytics
          </p>
        </div>

        <Card className="p-6">
          <Tabs defaultValue="signin">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-3 mt-4">
              <form onSubmit={onSignIn} className="space-y-3">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <Button type="submit" className="w-full" disabled={busy}>
                  Sign in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="space-y-3 mt-4">
              <form onSubmit={onSignUp} className="space-y-3">
                <Input
                  placeholder="Display name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <PasswordGuide checks={passwordChecks} />
                <Button type="submit" className="w-full" disabled={busy || !passwordIsSafe}>
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function getPasswordChecks(password: string, email: string, name: string) {
  const lowerPassword = password.toLowerCase();
  const emailName = email.split("@")[0]?.toLowerCase();
  const displayName = name.trim().toLowerCase();
  return [
    { label: "At least 8 characters", ok: password.length >= 8 },
    {
      label: "Uppercase and lowercase letters",
      ok: /[A-Z]/.test(password) && /[a-z]/.test(password),
    },
    { label: "At least one number", ok: /\d/.test(password) },
    { label: "A special character such as @, #, !", ok: /[^A-Za-z0-9]/.test(password) },
    {
      label: "Does not contain your name or email username",
      ok:
        !password ||
        ((!emailName || !lowerPassword.includes(emailName)) &&
          (!displayName || !lowerPassword.includes(displayName))),
    },
  ];
}

function PasswordGuide({ checks }: { checks: { label: string; ok: boolean }[] }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
      <div className="font-medium">Safe password guide</div>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div
            key={check.label}
            className={
              check.ok
                ? "text-success flex items-center gap-2"
                : "text-muted-foreground flex items-center gap-2"
            }
          >
            {check.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            <span>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatAuthError(error: string) {
  const normalized = error.toLowerCase();
  if (normalized.includes("email not confirmed") || normalized.includes("not confirmed")) {
    return "This email is not confirmed yet. Check your email to confirm the account before signing in.";
  }
  if (normalized.includes("weak password")) {
    return "This password is not safe enough. Use at least 8 characters with uppercase and lowercase letters, a number, and a special character.";
  }
  return error;
}
