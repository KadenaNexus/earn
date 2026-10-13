// Google Fonts load as a non-blocking print stylesheet; switch it on once it arrives.
// The CSP (script-src-attr 'none') blocks the usual inline onload handler, so this runs from a file.
for (const link of document.querySelectorAll('link[data-fonts]')) {
  if (link.sheet) link.media = 'all';
  else link.addEventListener('load', () => { link.media = 'all'; }, { once: true });
}
