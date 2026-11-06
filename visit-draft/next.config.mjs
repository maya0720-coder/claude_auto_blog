// 로컬 전용 앱 설정. 서버는 scripts/launch.ts가 127.0.0.1에만 띄운다.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js가 페이지에 넣는 인라인 스크립트·스타일 때문에 'unsafe-inline'이 필요하다. 외부 출처는 허용하지 않는다
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // 로컬 전용이라 압축 이득이 없고, 압축하면 진행 상황 스트림(SSE)이 모였다가 한꺼번에 전달될 수 있다
  compress: false,
  reactStrictMode: true,
  // 브라우저 자동화·이미지 처리 라이브러리는 번들하지 않고 Node에서 그대로 불러온다
  serverExternalPackages: ["playwright", "playwright-core", "sharp"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
