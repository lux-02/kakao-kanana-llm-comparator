import { AppHeader } from "@/components/shared/app-header";
import { ComparatorApp } from "@/components/comparator/comparator-app";

export default function Page() {
  return (
    <main className="shell">
      <AppHeader
        current="compare"
        subtitle="범용 LLM과 Kanana 모델의 결과물을 비교해보세요"
      />
      <ComparatorApp />
    </main>
  );
}
