(function () {
  const STORAGE_KEY = 'smartcut:pwa-install-dismissed-at';
  const INSTALL_COOLDOWN_DAYS = 7;
  let deferredPrompt = null;
  let promptShown = false;

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobileSafari = () => isIos() && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

  const dismissedRecently = () => {
    const value = Number(localStorage.getItem(STORAGE_KEY) || 0);
    if (!value) return false;
    return Date.now() - value < INSTALL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  };

  const rememberDismiss = () => localStorage.setItem(STORAGE_KEY, String(Date.now()));

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/notification-sw.js', { scope: '/' }).catch((error) => {
        console.warn('[PWA] Service worker registration failed', error);
      });
    });
  };

  const injectStyles = () => {
    if (document.getElementById('smartcut-pwa-style')) return;
    const style = document.createElement('style');
    style.id = 'smartcut-pwa-style';
    style.textContent = `
      .smartcut-pwa-layer{position:fixed;inset:auto 16px 16px;z-index:2147483000;display:flex;justify-content:center;pointer-events:none}
      .smartcut-pwa-card{width:min(430px,100%);border:1px solid rgba(198,167,94,.34);border-radius:28px;background:linear-gradient(145deg,rgba(31,30,28,.96),rgba(74,67,55,.95));color:#f8f2e7;box-shadow:0 24px 70px rgba(31,30,28,.28);padding:18px;pointer-events:auto;font-family:Manrope,Inter,system-ui,sans-serif;transform:translateY(18px);opacity:0;animation:smartcutPwaIn .36s ease forwards}
      .smartcut-pwa-top{display:flex;gap:14px;align-items:flex-start}
      .smartcut-pwa-icon{width:48px;height:48px;border-radius:16px;background:#f5f1e8;padding:6px;box-shadow:inset 0 0 0 1px rgba(198,167,94,.35)}
      .smartcut-pwa-kicker{margin:0 0 5px;color:#d9bd73;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
      .smartcut-pwa-title{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-size:26px;line-height:1.02;font-weight:700}
      .smartcut-pwa-text{margin:9px 0 0;color:rgba(248,242,231,.78);font-size:14px;line-height:1.45}
      .smartcut-pwa-actions{display:flex;gap:10px;margin-top:16px}
      .smartcut-pwa-btn{border:0;border-radius:999px;padding:12px 16px;font-weight:800;cursor:pointer}
      .smartcut-pwa-primary{flex:1;background:#d6b963;color:#1f1e1c}
      .smartcut-pwa-secondary{background:rgba(255,255,255,.1);color:#f8f2e7;border:1px solid rgba(255,255,255,.14)}
      .smartcut-pwa-ios{margin-top:14px;border-radius:18px;background:rgba(255,255,255,.08);padding:12px 14px;color:rgba(248,242,231,.84);font-size:13px;line-height:1.45}
      .smartcut-pwa-ios strong{color:#fff}
      @keyframes smartcutPwaIn{to{transform:translateY(0);opacity:1}}
      @media (min-width:720px){.smartcut-pwa-layer{inset:auto 24px 24px auto}.smartcut-pwa-card{width:410px}}
    `;
    document.head.appendChild(style);
  };

  const closeCard = (card, remember = true) => {
    if (remember) rememberDismiss();
    card?.closest('.smartcut-pwa-layer')?.remove();
  };

  const showInstallCard = ({ iosHelp = false } = {}) => {
    if (promptShown || isStandalone() || dismissedRecently()) return;
    if (!deferredPrompt && !iosHelp) return;
    promptShown = true;
    injectStyles();

    const layer = document.createElement('div');
    layer.className = 'smartcut-pwa-layer';
    const iosHint = '<div class="smartcut-pwa-ios">Sur iPhone: touchez <strong>Partager</strong>, puis <strong>Ajouter a l&apos;ecran d&apos;accueil</strong>.</div>';
    layer.innerHTML = `
      <section class="smartcut-pwa-card" role="dialog" aria-live="polite" aria-label="Installer Smart Cut Services">
        <div class="smartcut-pwa-top">
          <img class="smartcut-pwa-icon" src="/ico/android-chrome-192x192.png" alt="">
          <div>
            <p class="smartcut-pwa-kicker">Acces rapide</p>
            <h2 class="smartcut-pwa-title">Ajouter Smart Cut a votre ecran d'accueil</h2>
            <p class="smartcut-pwa-text">Ouvrez le site comme une app, plus vite, plus propre, sans chercher le lien chaque fois.</p>
          </div>
        </div>
        ${iosHelp ? iosHint : ''}
        <div class="smartcut-pwa-actions">
          <button type="button" class="smartcut-pwa-btn smartcut-pwa-primary">${iosHelp ? 'Compris' : 'Installer'}</button>
          <button type="button" class="smartcut-pwa-btn smartcut-pwa-secondary">Plus tard</button>
        </div>
      </section>
    `;
    document.body.appendChild(layer);

    const card = layer.querySelector('.smartcut-pwa-card');
    layer.querySelector('.smartcut-pwa-secondary').addEventListener('click', () => closeCard(card));
    layer.querySelector('.smartcut-pwa-primary').addEventListener('click', async () => {
      if (iosHelp) {
        closeCard(card);
        return;
      }
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      closeCard(card, false);
      if (!promptEvent) return;
      promptEvent.prompt();
      const result = await promptEvent.userChoice.catch(() => null);
      if (result?.outcome !== 'accepted') rememberDismiss();
    });
  };

  registerServiceWorker();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setTimeout(() => showInstallCard(), 1400);
  });

  window.addEventListener('appinstalled', () => {
    localStorage.removeItem(STORAGE_KEY);
    document.querySelector('.smartcut-pwa-layer')?.remove();
  });

  window.addEventListener('load', () => {
    if (isMobileSafari()) {
      setTimeout(() => showInstallCard({ iosHelp: true }), 2200);
    }
  });
})();
