import { AppHeader } from "@/components/shared/app-header";
import { WorkflowApp } from "@/components/workflow/workflow-app";

export default function WorkflowPage() {
  return (
    <main className="shell">
      <AppHeader
        current="workflow"
        subtitle="워크플로우를 구성하고 실행하세요"
      />
      <WorkflowApp />
    </main>
  );
}
