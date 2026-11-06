import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "../styles/tokens.css";
import "../styles/app.css";

// Pretendard(SIL OFL 1.1) — npm 패키지에 든 가변 글꼴을 빌드에 포함해 로컬에서만 제공한다(외부 요청 없음)
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "방문기록 — 블로그 후기 자동 작성",
  description: "사진과 장소·제품 정보로 네이버 블로그 후기 원고를 만들고 임시저장 (로컬 전용)",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
