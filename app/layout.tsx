import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RoomRelay — Book a room. Unlock access. Keep trust.",
    template: "%s · RoomRelay",
  },
  description:
    "A university room-booking and access-management prototype connecting discovery, approval, time-bound access, and accountable history.",
  applicationName: "RoomRelay",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#061521",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
