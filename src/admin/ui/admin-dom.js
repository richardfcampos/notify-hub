/**
 * Tiny DOM builder (ADMIN-07 UI). Avoids innerHTML string concatenation
 * with untrusted values (channel names, tokens, gateway error text) so
 * nothing coming from `.env` or the network is ever parsed as markup --
 * text children always go through createTextNode. The `html` attr is only
 * ever passed hardcoded icon strings from admin-icons.js, never user data.
 */

/** Creates `tag` with `attrs` applied and `children` appended. `on*` attrs
 * with a function value are wired via addEventListener (not inline HTML
 * attributes) so listeners are real closures, not string-evaluated. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      node.className = value
    } else if (key === 'html') {
      node.innerHTML = value
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value)
    } else if (value === true) {
      node.setAttribute(key, '')
    } else if (value !== false && value != null) {
      node.setAttribute(key, value)
    }
  }

  const kids = Array.isArray(children) ? children : [children]
  for (const child of kids) {
    if (child == null) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }

  return node
}

/** Removes every child node -- used before a targeted re-render. */
export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}
