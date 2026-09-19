import { ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";

export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="auth-page">
      <div className="auth-brand">
        <Brand />
      </div>
      <section className="auth-card card">{children}</section>
      <p className="auth-footer muted">
        Твои люди. Твой колледж. <ArrowUpRight size={14} aria-hidden="true" />
      </p>
    </main>
  );
}
