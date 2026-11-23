import { button } from './dom';

/**
 * The editor look's pieces (the Character Creator and TRAP): thin outline icons and the toolbar
 * button (a round icon with its label under it).
 */

/** Thin outline icons for the editor toolbars (stroke = currentColor). */
export const ln = (body: string) => `<svg viewBox="0 0 24 24" class="ln" aria-hidden="true">${body}</svg>`;
export const ED = {
  back: ln('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  chevron: ln('<path d="M7 10l5 5 5-5"/>'),
  full: ln('<circle cx="12" cy="4.6" r="2.1"/><path d="M8.2 9.2h7.6l-1 6.2h-1.6l-.6 6h-1.2l-.6-6H9.2z"/>'),
  upper: ln('<circle cx="12" cy="8" r="3.4"/><path d="M5 21c.6-4.4 3.4-7 7-7s6.4 2.6 7 7"/>'),
  faceView: ln('<ellipse cx="12" cy="12" rx="6.5" ry="8.5"/><path d="M9.5 10.5h.01M14.5 10.5h.01M10 15.2c1.3.9 2.7.9 4 0"/>'),
  zoomOut: ln('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20M7.8 10.5h5.4"/>'),
  zoomIn: ln('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20M7.8 10.5h5.4M10.5 7.8v5.4"/>'),
  trap: ln('<path d="M4.5 8.5h15l-1.4 11.5H5.9z"/><path d="M8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5"/>'),
  dice: ln('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.8 8.8h.01M15.2 15.2h.01M15.2 8.8h.01M8.8 15.2h.01M12 12h.01" stroke-width="2.6"/>'),
  reset: ln('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/>'),
  keep: ln('<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5"/><path d="M9 14.5l2.3 2.3L16 12.2"/>'),
  turnL: ln('<path d="M9 7H15a5 5 0 0 1 0 10H8"/><path d="M12 4L9 7l3 3"/>'),
  turnR: ln('<path d="M15 7H9a5 5 0 0 0 0 10h7"/><path d="M12 4l3 3-3 3"/>'),
  play: ln('<circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.8v6.4l5.2-3.2z"/>'),
  wave: ln('<path d="M8 12.5V6.8a1.4 1.4 0 0 1 2.8 0v4.7M10.8 11V5.4a1.4 1.4 0 0 1 2.8 0V11M13.6 11V6.6a1.4 1.4 0 0 1 2.8 0V14c0 4-2.4 7-5.9 7-2.4 0-3.9-1.3-5.2-3.4L4 14.6a1.4 1.4 0 0 1 2.4-1.5L8 15"/>'),
  more: ln('<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.8"/>'),
  split: ln('<path d="M9.5 8.5L6 12l3.5 3.5M14.5 8.5L18 12l-3.5 3.5"/>'),
  rotate: ln('<path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9"/><path d="M17 3.5v3.6h-3.6M7 20.5v-3.6h3.6"/>'),
  // categories
  starter: ln('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  body: ln('<circle cx="12" cy="4.6" r="2.1"/><path d="M8.2 9.2h7.6l-1 6.2h-1.6l-.6 6h-1.2l-.6-6H9.2z"/>'),
  head: ln('<ellipse cx="12" cy="11" rx="6" ry="7.6"/><path d="M9.2 21c.3-1.6 1.4-2.4 2.8-2.4s2.5.8 2.8 2.4"/>'),
  hair: ln('<path d="M5 14c0-6 3.2-9.5 7-9.5S19 8 19 14"/><path d="M5 14c1.8-1.6 3.7-2.4 6-2.6 1.9-.2 3.3-1.3 4-2.9.9 1.8 2.3 3.3 4 4.4"/><path d="M6.5 15v4.5M17.5 15v4.5"/>'),
  top: ln('<path d="M8.5 3.8L3.5 6.6l1.8 3.8 2.2-1.1V20h9V9.3l2.2 1.1 1.8-3.8-5-2.8c-.6 1.5-2 2.4-3.5 2.4s-2.9-.9-3.5-2.4z"/>'),
  pants: ln('<path d="M6.8 3.5h10.4l1 17.5h-4.1L12 10l-2.1 11H5.8z"/>'),
  shoes: ln('<path d="M3 15c0-1.8.6-3.6 1.4-5h4.1c.6 1.5 2.3 2.4 4.2 2.6 3.2.4 6.3 1.3 7.3 3.3V17H3z"/><path d="M3 19.5h18"/>'),
  hat: ln('<path d="M4.5 15c0-5 3.4-8.6 7.5-8.6s7.5 3.6 7.5 8.6z"/><path d="M12 15h9.5c0 1.4-1.6 2.2-4 2.2H12"/>'),
  gem: ln('<path d="M7 4.5h10l3.2 4.2L12 19.5 3.8 8.7z"/><path d="M3.8 8.7h16.4M9.6 4.5L12 19.5l2.4-15"/>'),
  tattoo: ln('<path d="M14.5 4.5l5 5M17 7l-8.5 8.5-3.5 1 1-3.5L14.5 4.5"/><path d="M4 20l2-2"/>'),
  // TRAP
  all: ln('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  gun: ln('<path d="M3 9.5h15l2-1.5h1v4h-6l-1 2h-2.5l-1.2 5H7l1-5H3z"/>'),
  bag: ln('<path d="M7 8.5a5 5 0 0 1 10 0V20H7z"/><path d="M9.5 8.5V7a2.5 2.5 0 0 1 5 0v1.5M9.5 14h5"/>'),
  star: ln('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
};
export const SHORT: Record<string, [string, string]> = {
  model: ['Character', ED.body],
  'wt-head': ['Skin & Head', ED.head], 'wt-top': ['Tops', ED.top], 'wt-bottom': ['Bottoms', ED.pants], 'wt-boots': ['Boots', ED.shoes],
  presets: ['Starter', ED.starter], body: ['Body', ED.body], head: ['Head', ED.head], hair: ['Hair', ED.hair], top: ['Tops', ED.top],
  bottom: ['Bottoms', ED.pants], shoes: ['Shoes', ED.shoes], headacc: ['Hats', ED.hat], jewelry: ['Jewelry', ED.gem], tattoos: ['Tattoos', ED.tattoo],
};

/** A toolbar button: a round icon with its label under it. */
export function tool(icon: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = button('', `ed-b${cls ? ` ${cls}` : ''}`, onClick);
  b.innerHTML = `<span class="ed-i">${icon}</span><span class="ed-l">${label}</span>`;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

