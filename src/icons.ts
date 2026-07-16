/** Flat monochrome SVG icons (currentColor, no fill) — used by the shell and
 * the web app in place of emoji. `icon(name)` returns an inline <svg> string. */
const PATHS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2 5.3"/><path d="M20 5.5v6h-6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7-2.3"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.6 2.6 2.6 13.4 0 16"/><path d="M12 4c-2.6 2.6-2.6 13.4 0 16"/>',
  link: '<path d="M9.5 14.5l5-5"/><path d="M11 6.5l1-1a4 4 0 0 1 5.7 5.7l-1 1"/><path d="M13 17.5l-1 1a4 4 0 0 1-5.7-5.7l1-1"/>',
  edit: '<path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  theme: '<circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  key: '<circle cx="8" cy="12" r="3.3"/><path d="M11.3 12H20l-2 2 2 1.8-3 2"/>',
  agent: '<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M9 8V5.5M15 8V5.5"/><path d="M9.5 13h.01M14.5 13h.01"/>',
  device: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6"/>',
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.7 9.6a2.4 2.4 0 0 1 3.9 1.9c0 1.4-1.9 1.8-1.9 3.3"/><path d="M12 17.5h.01"/>',
  signout: '<path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2"/><path d="M18 12H9"/><path d="M15 9l3 3-3 3"/>',
  storage: '<rect x="4" y="5" width="16" height="5" rx="1.5"/><rect x="4" y="14" width="16" height="5" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  read: '<path d="M4 6h16M4 10h16M4 14h11M4 18h7"/>',
};

export function icon(name: string, cls = ""): string {
  return (
    `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`
  );
}

export const ICON_CSS =
  ".ic{width:1.05em;height:1.05em;display:inline-block;vertical-align:-0.16em;flex:none}";
