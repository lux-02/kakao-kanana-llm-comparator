import Link from "next/link";

type AppHeaderProps = {
  current: "compare" | "workflow";
  subtitle: string;
};

export function AppHeader({ current, subtitle }: AppHeaderProps) {
  return (
    <header className="topbar panel topbar-minimal app-header">
      <div className="brand-lockup">
        <h1>kakao-kanana-llm-comparator</h1>
        <p className="subtitle compact-subtitle">{subtitle}</p>
      </div>

      <nav className="app-nav" aria-label="페이지 전환">
        <Link
          href="/"
          className={`app-nav-link${current === "compare" ? " active" : ""}`}
        >
          모델 비교
        </Link>
        <Link
          href="/workflow"
          className={`app-nav-link${current === "workflow" ? " active" : ""}`}
        >
          워크플로우
        </Link>
      </nav>
    </header>
  );
}
