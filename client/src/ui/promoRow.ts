import { ApiError } from '../net/account';
import { button, el } from './dom';

/**
 * "Have a promo code?" next to something for sale: a code box and an Apply button. `apply` gets
 * what was typed and does the redeeming (the server decides whether the code works); a refused
 * code shows its reason right under the box.
 */
export function promoRow(apply: (code: string) => Promise<void>, cls = ''): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'promo-input';
  input.placeholder = 'Promo code';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 32;
  input.setAttribute('aria-label', 'Promo code');
  input.setAttribute('autocapitalize', 'characters');
  const msg = el('div', 'promo-msg', '');
  const go = button('Apply', 'promo-apply', () => void submit());
  const submit = async (): Promise<void> => {
    const code = input.value.trim();
    if (!code) {
      msg.textContent = 'Type a code first.';
      input.focus();
      return;
    }
    go.disabled = true;
    input.disabled = true;
    msg.textContent = 'Checking…';
    try {
      await apply(code);
      msg.textContent = '';
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : 'That did not go through.';
      // (selected, so typing again replaces it)
      go.disabled = false;
      input.disabled = false;
      input.focus();
      input.select();
      return;
    }
    go.disabled = false;
    input.disabled = false;
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') void submit();
  });
  return el('div', `promo-row ${cls}`.trim(), [el('div', 'promo-line', [input, go]), msg]);
}
