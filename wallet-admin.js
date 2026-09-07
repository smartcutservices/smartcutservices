import { auth, authReadyPromise } from './firebase-init.js?v=20260901-1';

const base = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/';
const notice = document.getElementById('walletAdminNotice');
const show = (message, error = false) => { notice.textContent = message; notice.hidden = false; notice.className = `notice ${error ? 'is-error' : 'is-success'}`; setTimeout(() => { notice.hidden = true; }, 4500); };
async function api(name, options = {}) {
  await authReadyPromise;
  if (!auth.currentUser) throw new Error('Connexion administrateur requise.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${base}${name}`, { method: options.method || 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || 'Requête impossible.');
  return payload;
}
const setMoneyInput = (id, minor) => { const node = document.getElementById(id); if (node) node.value = Math.round(Number(minor || 0) / 100); };
async function load() {
  try {
    const data = await api('walletAdminWalletSettings');
    document.getElementById('adminStatus').textContent = 'Autorisé';
    setMoneyInput('minTopUp', data.limits.minTopUpMinor); setMoneyInput('maxTopUp', data.limits.maxTopUpMinor); setMoneyInput('walletCap', data.limits.walletCapMinor);
  } catch (error) { document.getElementById('adminStatus').textContent = 'Refusé'; show(error.message, true); }
}
document.getElementById('limitsForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await api('walletAdminWalletSettings', { method: 'POST', body: { minTopUpMinor: Number(document.getElementById('minTopUp').value) * 100, maxTopUpMinor: Number(document.getElementById('maxTopUp').value) * 100, walletCapMinor: Number(document.getElementById('walletCap').value) * 100 } }); show('Limites Wallet enregistrées.'); } catch (error) { show(error.message, true); } });
document.getElementById('reconcileBtn').addEventListener('click', async () => { const button = document.getElementById('reconcileBtn'); button.disabled = true; try { const result = await api('walletAdminWalletReconcile', { method: 'POST' }); document.getElementById('walletsChecked').textContent = result.walletsChecked; document.getElementById('walletDiscrepancies').textContent = result.discrepancyCount; document.getElementById('reconcileOutput').textContent = JSON.stringify(result.discrepancies || [], null, 2); show(result.discrepancyCount ? 'Des écarts nécessitent une vérification.' : 'Réconciliation terminée : aucun écart.'); } catch (error) { show(error.message, true); } finally { button.disabled = false; } });
document.getElementById('walletActionForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await api('walletAdminWalletAction', { method: 'POST', body: { userId: document.getElementById('actionUserId').value.trim(), action: document.getElementById('actionType').value, reason: document.getElementById('actionReason').value.trim() } }); show('Statut du Wallet mis à jour.'); event.currentTarget.reset(); } catch (error) { show(error.message, true); } });
load();
