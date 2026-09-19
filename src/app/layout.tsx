import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "NEXUS — твой колледж ближе", template: "%s · NEXUS" },
  description: "Место для общения, идей и людей твоего колледжа.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <a href="#main" className="skip-link">
          К содержимому
        </a>
        {children}
      </body>
    </html>
  );
}
