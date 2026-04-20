'use client';

import { LayoutGrid, Zap, MessageSquare, Phone, Brain, Settings } from 'lucide-react';
import type { PageId } from './Shell';

interface NavItem {
  id: PageId | null;
  icon: React.ReactNode;
  label: string;
}

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const topItems: NavItem[] = [
    { id: 'overview', icon: <LayoutGrid size={18} />, label: 'Overview' },
    { id: 'n8n', icon: <Zap size={18} />, label: 'N8N' },
    { id: 'fin', icon: <MessageSquare size={18} />, label: 'FIN' },
    { id: 'elevenlabs', icon: <Phone size={18} />, label: 'ElevenLabs' },
    { id: 'ai-tools', icon: <Brain size={18} />, label: 'AI Tools' },
  ];

  return (
    <div
      style={{
        width: 48,
        flexShrink: 0,
        background: '#050d07',
        borderRight: '1px solid #1a2c1d',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
        gap: 4,
      }}
    >
      {/* Logo / brand mark */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: '#3dba62',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#050d07' }}>AI</span>
      </div>

      {/* Divider */}
      <div style={{ width: 24, height: 1, background: '#1a2c1d', marginBottom: 4 }} />

      {/* Nav icons */}
      {topItems.map((item) => {
        const isActive = item.id !== null && activePage === item.id;
        return (
          <button
            key={item.id}
            onClick={() => item.id !== null && onNavigate(item.id)}
            title={item.label}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isActive ? '#3dba62' : 'transparent',
              color: isActive ? '#050d07' : '#6a8870',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background = '#112014';
                (e.currentTarget as HTMLButtonElement).style.color = '#e4ede6';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = '#6a8870';
              }
            }}
          >
            {item.icon}
          </button>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings (bottom, no page) */}
      <button
        title="Settings"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: '#6a8870',
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#112014';
          (e.currentTarget as HTMLButtonElement).style.color = '#e4ede6';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = '#6a8870';
        }}
      >
        <Settings size={18} />
      </button>
    </div>
  );
}
