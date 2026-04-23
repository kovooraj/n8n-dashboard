'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', error);
  }, [error]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#080f09',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <p style={{ color: '#e05858', fontSize: '1rem', fontWeight: 600, margin: 0 }}>
        Something went wrong
      </p>
      <p style={{ color: '#6a8870', fontSize: '0.8rem', margin: 0, maxWidth: 400, textAlign: 'center' }}>
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: 8,
          padding: '8px 20px',
          background: '#0d1810',
          border: '1px solid #2a4030',
          borderRadius: 6,
          color: '#3dba62',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 600,
        }}
      >
        Reload
      </button>
    </div>
  );
}
