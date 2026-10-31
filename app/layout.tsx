import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import { Toaster } from "sonner";
import { BRAND_TAGLINE, CRM_NAME } from "@/components/logo";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const sora = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-logo" });

export async function generateMetadata(): Promise<Metadata> {
  const name = await getSettings().then((s) => s.center_name, () => SETTING_DEFAULTS.center_name);
  return { title: `${name} × ${CRM_NAME}`, description: BRAND_TAGLINE };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
