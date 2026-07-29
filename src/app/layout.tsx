import type { Metadata } from "next";
import { Gantari } from "next/font/google";
import "./globals.css";
import { getT } from "@/lib/i18n/server";
import { themeAttribute } from "@/lib/theme/theme";
import { readTheme } from "@/lib/theme/read";

/**
 * The brand's complementary face, and the one it says to use for titles and
 * text. Self-hosted by next/font, so there is no request to Google at runtime
 * and no flash of a fallback face.
 */
const gantari = Gantari({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-gantari",
});

export const metadata: Metadata = {
  title: "MBE ERP",
  description: "Automatic task assignment and time tracking",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The company works in Spanish, so declaring English here had screen readers
  // reading Spanish with English pronunciation.
  const { locale } = await getT();

  // Rendered from the cookie rather than applied by script after paint, so a
  // chosen theme is right in the first frame. Absent for SYSTEM, which leaves
  // the OS preference in charge -- see globals.css.
  const theme = themeAttribute(await readTheme());

  return (
    <html
      lang={locale.toLowerCase()}
      data-theme={theme}
      className={gantari.variable}
    >
      <body>{children}</body>
    </html>
  );
}
