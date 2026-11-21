/**
 * The hands logo: a raised fist, white with a black ink outline (the look of the rest of the
 * HUD), for when you have nothing in your hands. `FIST_SHAPES` is the drawing in a 64 × 64 box,
 * so it can go into any SVG.
 */
const INK = '#16171a', WHITE = '#f4f1ea';

export const FIST_SHAPES = `<g stroke="${INK}" stroke-width="3" stroke-linejoin="round" fill="${WHITE}">
<path d="M22 46h20v14H22z"/>
<rect x="13" y="20" width="38" height="30" rx="11"/>
<rect x="13" y="9" width="10" height="19" rx="5"/>
<rect x="22.5" y="7" width="10" height="21" rx="5"/>
<rect x="32" y="8" width="10" height="20" rx="5"/>
<rect x="41.5" y="11" width="9.5" height="17" rx="4.75"/>
<path d="M11 33c0-3 2.5-5 5.5-5H31c3 0 5 2 5 4.5S34 37 31 37H20c-1.5 0-2.5 1-2.5 2.5V44c0 1.4-1.1 2.5-2.5 2.5-2.2 0-4-1.8-4-4z"/>
<path d="M26 54h12" stroke-width="2.4" fill="none"/>
</g>`;

/** The fist as a standalone SVG (inline HTML). */
export const FIST_SVG = `<svg class="fist" viewBox="0 0 64 64" aria-hidden="true">${FIST_SHAPES}</svg>`;

/** The fist as an image URL (for <img> pictures). */
export const FIST_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${FIST_SHAPES}</svg>`)}`;

/** A one-color fist the size of the kill-feed gun outlines (48 × 20). */
export const FIST_OUTLINE = '<svg viewBox="0 0 48 20"><path d="M17 4.5a2.5 2.5 0 015 0v.3a2.5 2.5 0 015 0v.2a2.5 2.5 0 015 0v.5a2.4 2.4 0 014.8 0V12a7 7 0 01-7 7h-6.6A7.2 7.2 0 0116 11.8z"/><path d="M15 10.5h9a2 2 0 010 4h-6v2.5h-3z" fill="#000" fill-opacity=".35"/></svg>';
