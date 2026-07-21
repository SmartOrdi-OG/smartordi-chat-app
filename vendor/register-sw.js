// Registers sw.js so the browser can offer "Install app" (Chrome/Edge show
// this as an icon in the address bar, or via the browser menu) -- a valid
// manifest.json alone isn't enough, every page needs this too.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  });
}
