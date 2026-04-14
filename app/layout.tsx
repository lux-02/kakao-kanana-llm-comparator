import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const kakaoFont = localFont({
  src: [
    {
      path: "../lib/woff2/KakaoSmallSans-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../lib/woff2/KakaoSmallSans-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../lib/woff2/KakaoSmallSans-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-kakao",
});

export const metadata: Metadata = {
  title: "Kanana 비교",
  description:
    "Kanana를 기준으로 GPT, Gemini, Claude 결과를 한 화면에서 비교하는 대시보드.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={kakaoFont.variable}>{children}</body>
    </html>
  );
}
