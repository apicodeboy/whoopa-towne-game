/** Tiny DOM builder: el('div', 'cls', 'text') or el('div', 'cls', [child, child]). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', content?: string | Array<Node | string | null | undefined>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else if (content) for (const c of content) if (c !== null && c !== undefined) node.append(c);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Shorthand for a button with a click handler. */
export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
