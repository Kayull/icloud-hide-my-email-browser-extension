export const AUTOFILL_STYLES = `
  :host { color-scheme: light dark; }
  * { box-sizing: border-box; }
  button {
    width: 100%; display: flex; align-items: center; gap: 10px;
    padding: 12px; margin: 0; border: 1px solid #dce1e8; border-radius: 14px;
    background: #fff; color: #17212f; text-align: left;
    box-shadow: 0 6px 24px #0f172a20, 0 2px 6px #0f172a0a;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer; transition: background 120ms, border-color 120ms;
  }
  button:hover[aria-disabled='false'] { background: #f4f8ff; border-color: #a5c4f5; }
  button:focus-visible { outline: 3px solid #4388f5; outline-offset: 2px; }
  button[aria-disabled='true'] { cursor: progress; }
  .icon {
    display: grid; place-items: center; flex: 0 0 32px; height: 32px;
    border-radius: 10px; background: #eaf2ff; color: #2563eb; font-size: 19px;
  }
  .copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 2px; }
  .title { font-weight: 600; letter-spacing: -.1px; }
  .detail { font-size: 11px; color: #596779; overflow-wrap: anywhere; }
  .action { flex-shrink: 0; color: #2563eb; font-size: 11px; font-weight: 600; }
  [data-state='error'] .detail { color: #ad4c16; }
  [data-state='loading'] .action, [data-state='reserving'] .action { color: #596779; }
  @media (prefers-color-scheme: dark) {
    button { background: #202329; border-color: #414650; color: #f3f5f8; box-shadow: 0 8px 28px #0005; }
    button:hover[aria-disabled='false'] { background: #282e38; border-color: #638ecf; }
    .icon { background: #293b59; color: #95bfff; }
    .detail { color: #acb5c3; }
    .action { color: #95bfff; }
    [data-state='error'] .detail { color: #ffc499; }
  }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;
