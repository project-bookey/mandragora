import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans_KR({ weight: ["400", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-noto", preload: false });

export const metadata: Metadata = {
  title: "만드라고라",
  description: "누군가 남긴 말을 뽑아보세요.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={noto.variable}>
      <body>{children}</body>
    </html>
  );
}
