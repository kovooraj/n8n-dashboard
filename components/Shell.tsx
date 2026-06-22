'use client';

import { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { OverviewPage } from '@/components/pages/OverviewPage';
import { N8NPage } from '@/components/pages/N8NPage';
import { FINPage } from '@/components/pages/FINPage';
import { ElevenLabsPage } from '@/components/pages/ElevenLabsPage';
import { AIToolsPage } from '@/components/pages/AIToolsPage';
import { HeartbeatPage } from '@/components/pages/HeartbeatPage';

export type PageId = 'overview' | 'n8n' | 'fin' | 'elevenlabs' | 'ai-tools' | 'heartbeat';

const PAGE_IDS: PageId[] = ['overview', 'n8n', 'fin', 'elevenlabs', 'ai-tools', 'heartbeat'];
const PAGE_STORAGE_KEY = 'ai_dash_page';

// Resolve the page to show on load: ?page= in the URL wins, then the last page
// saved in localStorage, else Overview.
function resolveInitialPage(): PageId | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('page');
  if (fromUrl && PAGE_IDS.includes(fromUrl as PageId)) return fromUrl as PageId;
  const fromStore = localStorage.getItem(PAGE_STORAGE_KEY);
  if (fromStore && PAGE_IDS.includes(fromStore as PageId)) return fromStore as PageId;
  return null;
}

export function Shell() {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const didInit = useRef(false);

  // Restore the page from URL / localStorage on mount (avoids SSR hydration mismatch).
  useEffect(() => {
    const p = resolveInitialPage();
    if (p && p !== activePage) setActivePage(p);
  }, []);

  // Keep the URL (?page=) and localStorage in sync so refresh + deep links work.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!didInit.current) { didInit.current = true; return; } // skip the first commit
    localStorage.setItem(PAGE_STORAGE_KEY, activePage);
    const url = new URL(window.location.href);
    if (url.searchParams.get('page') !== activePage) {
      url.searchParams.set('page', activePage);
      window.history.replaceState(null, '', url.toString());
    }
  }, [activePage]);

  // Support browser back/forward.
  useEffect(() => {
    const onPop = () => {
      const p = resolveInitialPage();
      if (p) setActivePage(p);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
          {activePage === 'heartbeat' && <HeartbeatPage />}
        </div>
      </div>
    </div>
  );
}
