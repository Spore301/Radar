import { Suspense } from 'react';
import { AgentChat } from '@/components/agent/AgentChat';

export default function AgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentChat />
    </Suspense>
  );
}
