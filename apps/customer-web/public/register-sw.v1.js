if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.v1.js', { scope: '/' }).catch(() => {});
  });
}
