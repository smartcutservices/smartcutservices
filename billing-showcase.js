export default class BillingShowcase {
  constructor(rootId) {
    const root = document.getElementById(rootId); if (!root) return;
    root.innerHTML = `<style>
      #${rootId}{padding:clamp(48px,8vw,92px) 20px;background:#fff;color:#111827}
      #${rootId} .billing-wrap{max-width:1180px;margin:auto;display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(28px,6vw,78px);align-items:center;padding:clamp(28px,5vw,58px);border:1px solid #e5e7eb;border-radius:28px;background:linear-gradient(145deg,#fff 40%,#fff8eb);box-shadow:0 24px 70px rgba(15,23,42,.08)}
      #${rootId} .billing-kicker{color:#b45309;font-size:12px;font-weight:850;letter-spacing:.15em;text-transform:uppercase;margin:0 0 12px}
      #${rootId} h2{font-size:clamp(32px,5vw,58px);line-height:1.02;letter-spacing:-.04em;margin:0 0 18px}
      #${rootId} .billing-copy{font-size:clamp(16px,2vw,19px);line-height:1.7;color:#64748b;max-width:620px}
      #${rootId} .billing-cta{display:inline-flex;margin-top:22px;padding:13px 18px;border-radius:10px;background:#f59e0b;color:#111827;text-decoration:none;font-weight:850}
      #${rootId} .billing-flow{display:grid;gap:10px}
      #${rootId} .billing-step{display:grid;grid-template-columns:42px 1fr;gap:13px;align-items:center;padding:15px;border:1px solid #e5e7eb;border-radius:14px;background:rgba(255,255,255,.86)}
      #${rootId} .billing-step span{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#111827;color:#fff;font-weight:900}
      #${rootId} .billing-step strong,#${rootId} .billing-step small{display:block} #${rootId} .billing-step small{color:#64748b;margin-top:3px}
      @media(max-width:760px){#${rootId}{padding:42px 14px}#${rootId} .billing-wrap{grid-template-columns:1fr;padding:25px 20px;border-radius:20px}}
    </style><div class="billing-wrap"><div><p class="billing-kicker">Factures & Paiements</p><h2>Créez. Facturez. Encaissez.</h2><p class="billing-copy">Préparez une proforma professionnelle, partagez-la avec votre client, recevez son paiement MonCash et suivez vos revenus dans un seul espace SmartCut.</p><a class="billing-cta" href="./logiciel%20proformat/">Accéder à Factures & Paiements</a></div><div class="billing-flow" aria-label="Fonctionnement"><div class="billing-step"><span>1</span><div><strong>Créez votre proforma</strong><small>Clients, services et PDF professionnel.</small></div></div><div class="billing-step"><span>2</span><div><strong>Partagez et encaissez</strong><small>Lien sécurisé et paiement MonCash vérifié.</small></div></div><div class="billing-step"><span>3</span><div><strong>Gérez vos revenus</strong><small>Ledger, solde et retraits suivis.</small></div></div></div></div>`;
  }
}
