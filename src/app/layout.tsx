import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "task-erp",
  description: "Automatic task assignment and time tracking",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
