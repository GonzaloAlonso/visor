export async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : `HTTP ${res.status}`);
  }
  return data;
}

/** WebSocket with automatic reconnect. onFrame receives parsed frames. */
export function connect(onFrame, onState) {
  let ws;
  let retry = 500;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 500; onState?.(true); };
    ws.onmessage = (e) => onFrame(JSON.parse(e.data));
    ws.onclose = () => {
      onState?.(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  open();
}
