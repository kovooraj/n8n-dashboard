'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { OverviewPage } from '@/components/pages/OverviewPage';
import { N8NPage } from '@/components/pages/N8NPage';
import { FINPage } from '@/components/pages/FINPage';
import { ElevenLabsPage } from '@/components/pages/ElevenLabsPage';
import { AIToolsPage } from '@/components/pages/AIToolsPage';

export type PageId = 'overview' | 'n8n' | 'fin' | 'elevenlabs' | 'ai-tools';

export function Shell() {
  const [activePage, setActivePage] = useState<PageId>('overview');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#080f09',
      }}
    >
      {/* Left icon sidebar */}
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      {/* Main area: TopBar + page content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar />

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activePage === 'overview' && <OverviewPage />}
          {activePage === 'n8n' && <N8NPage />}
          {activePage === 'fin' && <FINPage />}
          {activePage === 'elevenlabs' && <ElevenLabsPage />}
          {activePage === 'ai-tools' && <AIToolsPage />}
        </div>
      </div>
    </div>
  );
}
