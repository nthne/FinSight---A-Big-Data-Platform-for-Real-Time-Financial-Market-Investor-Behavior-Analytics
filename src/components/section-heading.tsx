import { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b bg-gradient-to-b from-card to-background">
      <div className="px-4 sm:px-8 py-8 max-w-[1400px] mx-auto flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          {eyebrow && <div className="small-caps text-[0.7rem] text-muted-foreground mb-2">{eyebrow}</div>}
          <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="px-4 sm:px-8 py-8 max-w-[1400px] mx-auto space-y-8">{children}</div>;
}
