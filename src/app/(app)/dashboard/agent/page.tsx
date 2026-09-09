import { Suspense } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { AgentChat } from '@/components/agent/AgentChat';

export default function AgentPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Agent"
        title="Describe the role, get the search"
        description="Everything the upload-and-form flow does, in conversation — with the agent's reasoning shown at every step."
      />
      <Suspense fallback={null}>
        <AgentChat />
      </Suspense>
    </div>
  );
}
