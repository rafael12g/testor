import { useState, useEffect, useRef } from 'react';

export default function useWebSocket(enabled, onMessage) {
  const [state, setState] = useState('offline');
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    if (!enabled) { setState('offline'); return; }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws`;
    let ws;

    try {
      setState('connecting');
      ws = new WebSocket(wsUrl);
    } catch {
      setState('error');
      return;
    }

    ws.onopen = () => setState('online');
    ws.onclose = () => setState('offline');
    ws.onerror = () => setState('error');
    ws.onmessage = (e) => { try { cbRef.current(JSON.parse(e.data)); } catch {} };

    return () => { if (ws?.readyState === WebSocket.OPEN) ws.close(); };
  }, [enabled]);

  return state;
}
