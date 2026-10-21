import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobBuddy",
  description: "Finds jobs, tailors your CV and fills in forms. You always press Submit.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
