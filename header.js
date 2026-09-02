import { db } from './firebase-init.js?v=20260901-1';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import './search.js?v=20260901-1';
import Navbar from './navbar.js?v=20260901-1';
import { getCartManager } from './cart.js?v=20260901-1';
import { getAuthManager } from './auth.js?v=20260901-1';
import { getProfilePanel } from './profile-panel.js?v=20260901-6';
import { getWebsiteAnalyticsTracker } from './analytics-tracker.js';
import { getUserDisplayCurrency, loadCurrencySettings, setUserDisplayCurrency } from './currency-utils.js';
import { applyNavPreference } from './nav-preference.js?v=20260901-1';

// Rangée de navlinks personnalisable : le dernier lien ouvert repasse en tête.
// Réservé à la page d'accueil : aucun autre en-tête du site (Health, Éducation,
// Auto & Parts…) ne doit réordonner ses liens.
const MAIN_NAV_PREF_KEY = 'sc:navOrder:main:v1';

function isHomePage() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '');
  return path === '' || /\/index\.html?$/i.test(path);
}

class SierraHeaderNebula {
  constructor(containerId = 'sierra-header-root') {
    this.containerId = containerId;
    this.navbar = null;
    this.cartManager = null;
    this.authManager = null;
    this.handleCartUpdated = null;
    this.handleStorageSync = null;
    this.handleWindowResize = null;
    this.headerResizeObserver = null;

    this.injectStyles();
    this.render();
    this.init();
  }

  injectStyles() {
    const styleId = 'sierra-header-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      :root {
        --primary-color: var(--sc-brand, #3a4e3f);
        --secondary-color: var(--sc-brand-2, #b89b7b);
        --accent-color: var(--sc-brand-accent, #7c3e3e);
        --primary-font: 'Amazon Ember', Arial, sans-serif;
        --brand-font: 'Playfair Display', 'Amazon Ember', Arial, sans-serif;
        --secondary-font: 'Amazon Ember', sans-serif;
        --announce-height: 0px;
        --header-height: 156px;
        --header-height-mobile: 92px;
      }

      #headerNebulaX92 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 1000;
        transition: transform 0.35s ease, background 0.3s ease, box-shadow 0.3s ease;
        font-family: var(--secondary-font);
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(14px);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(184, 155, 123, 0.08);
      }

      .header-transparent {
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(14px);
      }

      .header-solid {
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(12px);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(184, 155, 123, 0.08);
      }

      #announcementBarVega33 {
        display: none !important;
        height: 0 !important;
      }

      .desktop-header-inner {
        max-width: 1440px;
        margin: 0 auto;
        padding: 1.15rem 2rem 1rem;
        height: auto;
        display: grid;
        gap: 0.9rem;
      }

      .desktop-top-row {
        display: grid;
        grid-template-columns: auto minmax(320px, 1fr) auto;
        align-items: center;
        gap: 1.2rem;
      }

      .desktop-nav-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        min-width: 0;
        position: relative;
        padding-top: 0.15rem;
        border-top: 1px solid rgba(184, 155, 123, 0.14);
        overflow: visible;
      }

      .desktop-nav-items {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        min-width: max-content;
        flex: 0 0 auto;
        overflow: visible;
      }

      .desktop-nav-items .desktop-nav-action {
        flex-shrink: 0;
      }

      .desktop-logo-area {
        display: flex;
        align-items: center;
        gap: 0.9rem;
        min-width: 0;
      }

      .header-home-link {
        display: inline-flex;
        align-items: center;
        gap: 0.9rem;
        color: inherit;
        text-decoration: none;
      }

      .desktop-logo {
        height: 54px;
        width: auto;
        object-fit: contain;
      }

      .desktop-company-name {
        font-family: var(--brand-font);
        font-size: 1.3rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #141414;
        white-space: nowrap;
      }

      .desktop-categories {
        display: flex;
        gap: 1.35rem;
        margin-left: 0;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .desktop-categories::-webkit-scrollbar,
      .desktop-nav-items::-webkit-scrollbar,
      .mobile-nav-items::-webkit-scrollbar {
        display: none;
      }

      .desktop-all-button,
      .desktop-nav-action,
      .mobile-nav-all,
      .mobile-nav-item {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        text-decoration: none;
        white-space: nowrap;
        border: none;
        background: transparent;
        cursor: pointer;
        font-family: var(--secondary-font);
      }

      .categoryTriggerLux77 {
        font-size: 0.92rem;
        font-weight: 600;
        color: #1e1e1e;
        padding: 0.65rem 0;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.25s ease;
        white-space: nowrap;
      }

      .desktop-all-button {
        position: absolute;
        left: 0;
        padding: 0.65rem 0.95rem;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.12);
        color: #0f1111;
        font-size: 0.9rem;
        font-weight: 700;
        flex-shrink: 0;
        z-index: 4;
        box-shadow: 0 6px 16px rgba(16, 25, 35, 0.1);
      }

      .desktop-nav-action {
        padding: 0.58rem 0.78rem;
        border-radius: 999px;
        color: #0f1111;
        font-size: 0.9rem;
        font-weight: 700;
        background: rgba(255, 255, 255, 0.78);
        box-shadow: inset 0 0 0 1px rgba(184, 155, 123, 0.18);
        transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
      }

      .desktop-nav-action:hover,
      .mobile-nav-item:hover {
        background: rgba(198, 167, 94, 0.16);
        color: #8b6c2f;
        transform: translateY(-1px);
      }

      .smartsolution-menu { position: relative; flex: 0 0 auto; }
      .smartsolution-menu__trigger {
        display: inline-flex;
        align-items: center;
        padding: 0.58rem 0.25rem;
        border: 0;
        border-bottom: 2px solid transparent;
        color: #fff;
        background: transparent;
        cursor: pointer;
        font: 700 0.9rem var(--secondary-font);
        white-space: nowrap;
        transition: color .2s ease, border-color .2s ease;
      }
      .smartsolution-menu__trigger:hover,
      .smartsolution-menu.is-open .smartsolution-menu__trigger,
      .smartsolution-menu:hover .smartsolution-menu__trigger { color: #fff; border-bottom-color: rgba(255,255,255,.72); }
      .smartsolution-menu__panel { position: absolute; top: calc(100% + 0.55rem); left: -0.55rem; z-index: 1010; display: grid; min-width: 248px; padding: 0.45rem; border: 1px solid rgba(24, 36, 49, 0.14); border-radius: 8px; background: #fff; box-shadow: 0 18px 40px rgba(25, 25, 25, 0.14); }
      .smartsolution-menu__panel[hidden] { display: none; }
      .smartsolution-menu__panel a { display: flex; align-items: center; gap: 0.65rem; padding: 0.68rem 0.75rem; border-radius: 5px; color: #24313d; font-size: 0.84rem; font-weight: 700; text-decoration: none; }
      .smartsolution-menu__panel a i { width: 17px; color: #8b6c2f; text-align: center; }
      .smartsolution-menu__panel a:hover { background: #f5f1eb; color: #6f5424; }
      .mobile-smartsolution-menu { position: relative; flex: 0 0 auto; }
      .mobile-smartsolution-menu summary { list-style: none; }
      .mobile-smartsolution-menu summary::-webkit-details-marker { display: none; }
      .mobile-smartsolution-menu[open] > summary { color: #fff; border-bottom: 2px solid rgba(255,255,255,.72); }
      .mobile-smartsolution-menu__panel { position: fixed; top: calc(var(--header-height-mobile) - 2px); left: 0.75rem; right: 0.75rem; z-index: 1010; display: grid; max-height: 60vh; overflow-y: auto; min-width: 248px; padding: 0.45rem; border: 1px solid rgba(24, 36, 49, 0.14); border-radius: 8px; background: #fff; box-shadow: 0 18px 40px rgba(25, 25, 25, 0.14); }
      .mobile-smartsolution-menu__panel a { display: flex; align-items: center; gap: 0.65rem; padding: 0.68rem 0.75rem; border-radius: 5px; color: #24313d; font-size: 0.84rem; font-weight: 700; text-decoration: none; }.mobile-smartsolution-menu__panel a:hover { background: #f5f1eb; color: #6f5424; }.mobile-smartsolution-menu__panel a i { width: 17px; color: #8b6c2f; text-align: center; }

      .desktop-icons {
        display: flex;
        gap: 0.8rem;
        align-items: center;
      }

      .currency-selector {
        border: 1px solid rgba(184, 155, 123, 0.2);
        background: rgba(255, 255, 255, 0.78);
        color: #0f1111;
        border-radius: 999px;
        min-height: 44px;
        padding: 0 0.75rem;
        font-family: var(--secondary-font);
        font-size: 0.82rem;
        font-weight: 800;
        cursor: pointer;
        outline: none;
      }

      .currency-selector:focus {
        box-shadow: 0 0 0 3px rgba(198, 167, 94, 0.18);
      }

      .desktop-icon-button,
      .mobile-icon-button {
        border: none;
        background: rgba(184, 155, 123, 0.1);
        color: #1e1e1e;
        width: 44px;
        height: 44px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s ease, background 0.2s ease;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .desktop-icon-button:hover,
      .mobile-icon-button:hover {
        transform: translateY(-1px);
        background: rgba(184, 155, 123, 0.18);
      }

      .desktop-icon,
      .mobile-icon {
        font-size: 1.15rem;
        color: #1e1e1e;
        cursor: pointer;
        transition: all 0.25s ease;
      }
      .smartsolution-menu__chevron { margin-left:.35rem; font-size:.68em; transition:transform .2s ease; }
      .smartsolution-menu.is-open .smartsolution-menu__chevron,
      .mobile-smartsolution-menu[open] .smartsolution-menu__chevron { transform:rotate(180deg); }

      .profile-header-avatar {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        object-position: center;
      }

      .header-search-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        border: none;
        cursor: pointer;
        font-family: var(--secondary-font);
      }

      .desktop-search-bar {
        width: 100%;
        min-height: 48px;
        justify-content: flex-start;
        padding: 0 1rem;
        border-radius: 14px;
        background: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(184, 155, 123, 0.18);
        color: #5e584f;
        font-size: 0.98rem;
      }

      .desktop-search-bar i,
      .mobile-search-bar i {
        color: #565959;
      }

      .desktop-search-input,
      .mobile-search-input {
        flex: 1;
        border: none;
        background: transparent;
        color: #2a2825;
        font-size: inherit;
        font-family: var(--secondary-font);
        outline: none;
        min-width: 0;
      }

      .desktop-search-input::placeholder,
      .mobile-search-input::placeholder {
        color: #857d71;
      }

      .cart-icon-shell {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.1);
        border: none;
        cursor: pointer;
        padding: 0;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .cart-count-badge {
        position: absolute;
        top: -6px;
        right: -7px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        display: none;
        align-items: center;
        justify-content: center;
        background: #FFA41C;
        color: #0F1111;
        font-size: 0.72rem;
        font-weight: 800;
        line-height: 1;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.16);
        pointer-events: none;
      }

      .desktop-icon:hover,
      .mobile-icon:hover {
        transform: scale(1.06);
      }

      .mobile-header-inner {
        display: none;
        padding: 0.65rem 0.9rem 0.6rem;
        position: relative;
        flex-direction: column;
        align-items: stretch;
        gap: 0.5rem;
      }

      .mobile-top-bar {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.6rem;
      }

      .mobile-left-group {
        display: flex;
        align-items: center;
        width: auto;
      }

      .mobile-hamburger {
        width: 42px;
        height: 42px;
        font-size: 1.15rem;
        color: #1e1e1e;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.12);
      }

      .mobile-logo-center {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        min-width: 0;
      }

      .mobile-logo-link {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 0.55rem;
        min-width: 0;
        text-decoration: none;
        color: inherit;
      }

      .mobile-logo {
        height: 38px;
        width: auto;
        object-fit: contain;
      }

      .mobile-logo-text {
        font-family: var(--brand-font);
        font-size: 1rem;
        font-weight: 700;
        color: #141414;
        display: none;
      }

      .mobile-right-group {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        width: auto;
        justify-content: flex-end;
        flex-shrink: 0;
      }

      .mobile-search-bar {
        width: 100%;
        min-height: 38px;
        justify-content: flex-start;
        padding: 0 0.8rem;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(184, 155, 123, 0.18);
        color: #6f695f;
        font-size: 0.88rem;
        min-width: 0;
      }

      .mobile-nav-scroll {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        overflow: hidden;
        white-space: nowrap;
        flex-wrap: nowrap;
      }

      .mobile-nav-scroll::-webkit-scrollbar {
        display: none;
      }

      .mobile-nav-all {
        padding: 0.55rem 0.9rem;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.16);
        color: #0f1111;
        font-size: 0.88rem;
        font-weight: 700;
        flex-shrink: 0;
        flex: 0 0 auto;
      }

      .mobile-nav-items {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex: 1 1 auto;
        flex-wrap: nowrap;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        scroll-behavior: smooth;
        touch-action: pan-x;
      }

      .mobile-nav-item {
        padding: 0.55rem 0.62rem;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        color: #273440;
        font-size: 0.84rem;
        font-weight: 700;
        flex: 0 0 auto;
      }

      .mobile-nav-all { position: sticky; left: 0; z-index: 4; box-shadow: 0 5px 14px rgba(16, 25, 35, 0.1); }
      .mobile-nav-arrow { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px; padding: 0; border: 1px solid rgba(255,255,255,.34); border-radius: 9px; color: #fff; background: rgba(15,25,37,.78); box-shadow: 0 4px 12px rgba(16,25,35,.2); cursor: pointer; opacity: 1; visibility: visible; transform: translateX(0); transition: opacity .25s ease, visibility .25s ease, transform .25s ease, background-color .2s ease, border-color .2s ease; }
      .mobile-nav-arrow[hidden] { display: none; }
      .mobile-nav-arrow:hover { color: #fff; background: #8b6c2f; border-color: rgba(255,255,255,.72); }
      .mobile-nav-scroll.is-idle .mobile-nav-arrow:not([hidden]) { opacity: 0; visibility: hidden; pointer-events: none; transform: translateX(3px); }
      .mobile-nav-scroll.is-idle .mobile-nav-arrow#mobileNavScrollLeft:not([hidden]) { transform: translateX(-3px); }


      #megaPortalLux21 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(16px);
        z-index: 4000;
        display: none;
        opacity: 0;
        transition: opacity 0.4s ease;
        overflow-y: auto;
      }

      .mega-content {
        max-width: 1400px;
        margin: 100px auto 0;
        padding: 2rem 4rem;
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: 4rem;
      }

      .mega-columns-area {
        display: flex;
        gap: 3.5rem;
        flex-wrap: wrap;
      }

      .mega-column {
        min-width: 200px;
      }

      .mega-column-title {
        font-family: var(--primary-font);
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 1rem;
        border-bottom: 1px solid var(--secondary-color);
        padding-bottom: 0.45rem;
      }

      .mega-lines {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .mega-line {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.45rem 0.6rem;
        border-radius: 12px;
        text-decoration: none;
        cursor: pointer;
      }

      .mega-line-image {
        width: 32px;
        height: 32px;
        min-width: 32px;
        border-radius: 8px;
        object-fit: cover;
      }

      .mega-featured-products {
        background: rgba(184, 155, 123, 0.06);
        border-radius: 28px;
        padding: 2rem;
      }

      .featured-grid {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .mega-close-btn {
        position: fixed;
        top: 20px;
        right: 28px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid rgba(184, 155, 123, 0.4);
        background: #fff;
        font-size: 1.35rem;
        cursor: pointer;
        z-index: 4001;
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.14);
      }

      #mobileMenuFullscreenOrion99 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100dvh;
        border: 1px solid rgba(196, 143, 57, 0.34);
        border-radius: 0;
        background: #fffdf8;
        box-shadow: 0 0 0 100vmax rgba(11, 18, 29, 0.84), 0 26px 70px rgba(0, 0, 0, 0.24);
        z-index: 2000;
        display: none;
        opacity: 0;
        transition: opacity 0.32s ease, transform 0.32s ease;
        overflow-y: auto;
        overflow-x: hidden;
        transform: translateY(0.75rem);
        overscroll-behavior: contain;
      }

      #mobileMenuFullscreenOrion99.is-open {
        transform: translateY(0);
      }

      #mobileMenuFullscreenOrion99::before {
        content: '';
        position: absolute;
        top: 1.55rem;
        left: 50%;
        width: 7.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: #d9d5ce;
        transform: translateX(-50%);
      }

      .mobile-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: clamp(4.7rem, 8vw, 6.3rem) clamp(1.4rem, 6vw, 4.4rem) 2rem;
        border: 0;
        margin: 0;
      }

      .mobile-menu-title {
        position: relative;
        font-family: var(--brand-font), Georgia, serif;
        font-size: clamp(2.6rem, 6vw, 4.4rem);
        font-weight: 700;
        letter-spacing: -0.045em;
        line-height: 1;
      }

      .mobile-menu-title::after {
        content: '';
        position: absolute;
        left: 0;
        bottom: -1.2rem;
        width: 4.2rem;
        height: 0.3rem;
        border-radius: 999px;
        background: #d49a3d;
        box-shadow: 4.8rem 0 0 -0.08rem #d49a3d;
      }

      .mobile-menu-close {
        width: clamp(3.4rem, 8vw, 5.25rem);
        height: clamp(3.4rem, 8vw, 5.25rem);
        border-radius: 50%;
        border: 1px solid #d3a25b;
        background: rgba(255, 255, 255, 0.92);
        color: #c58d3b;
        font-size: clamp(1.35rem, 3vw, 2rem);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 9px 20px rgba(96, 67, 24, 0.13);
      }

      .mobile-categories-section,
      .mobile-columns-section,
      #mobileLinesLevel {
        padding: 0 clamp(1.4rem, 6vw, 4.4rem);
      }

      .mobile-category-carousel {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: clamp(1rem, 2.4vw, 1.7rem);
        margin: 1.5rem 0 2.5rem;
        overflow: visible;
      }

      .mobile-category-carousel::-webkit-scrollbar {
        display: none;
      }

      .mobile-category-card {
        position: relative;
        display: grid;
        place-items: center;
        align-content: center;
        min-width: 0;
        min-height: clamp(13rem, 34vw, 23rem);
        padding: clamp(1rem, 3vw, 1.8rem);
        overflow: hidden;
        border: 1px solid rgba(211, 178, 126, 0.26);
        border-radius: clamp(1.2rem, 3vw, 1.8rem);
        background: rgba(255, 255, 255, 0.76);
        box-shadow: 0 10px 24px rgba(65, 49, 28, 0.09);
        text-align: center;
        cursor: pointer;
        transition: transform 0.22s ease, box-shadow 0.22s ease;
      }

      .mobile-category-card:hover,
      .mobile-category-card:focus-visible {
        transform: translateY(-3px);
        box-shadow: 0 16px 32px rgba(65, 49, 28, 0.14);
        outline: none;
      }

      .mobile-category-image-wrap {
        position: relative;
        display: grid;
        place-items: center;
        width: clamp(6.5rem, 20vw, 14rem);
        height: clamp(6.5rem, 20vw, 14rem);
        border-radius: 50%;
        border: 2px solid #d2a15c;
        margin: 0 auto clamp(0.8rem, 2vw, 1.3rem);
        overflow: hidden;
        background: radial-gradient(circle at 35% 30%, #fffdf7, #efe3cf 72%, #dfc49b);
        box-shadow: 0 0 0 4px rgba(255,255,255,.72), 0 8px 22px rgba(75,52,24,.12);
      }

      .mobile-category-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        border-radius: inherit;
      }

      .mobile-category-fallback-icon {
        display: none;
        color: #bd8331;
        font-size: clamp(2.2rem, 7vw, 5rem);
        filter: drop-shadow(0 5px 8px rgba(94, 59, 16, 0.14));
      }

      .mobile-category-image-wrap.is-fallback .mobile-category-image { display: none; }
      .mobile-category-image-wrap.is-fallback .mobile-category-fallback-icon { display: block; }

      .mobile-category-name {
        position: relative;
        display: block;
        max-width: 16rem;
        padding-bottom: 0.9rem;
        font-family: var(--brand-font), Georgia, serif;
        font-size: clamp(1.05rem, 2.7vw, 1.9rem);
        font-weight: 600;
        line-height: 1.08;
        color: #24211e;
      }

      .mobile-category-name::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        width: 2.35rem;
        height: 2px;
        border-radius: 999px;
        background: #d49a3d;
        transform: translateX(-50%);
      }

      .mobile-category-arrow {
        position: absolute;
        top: clamp(0.8rem, 2vw, 1.5rem);
        right: clamp(0.8rem, 2vw, 1.5rem);
        display: grid;
        place-items: center;
        width: clamp(2.6rem, 6vw, 3.8rem);
        height: clamp(2.6rem, 6vw, 3.8rem);
        border: 1px solid rgba(210, 161, 92, 0.48);
        border-radius: 50%;
        background: rgba(255,255,255,.86);
        color: #c58d3b;
        font-size: clamp(1rem, 2vw, 1.4rem);
      }

      .mobile-back-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        font-size: 1.6rem;
        border-radius: 50%;
        cursor: pointer;
      }

      #mobileMenuContent {
        padding-bottom: 0;
      }

      .mobile-menu-footer {
        position: static;
        z-index: 4;
        display: grid;
        grid-template-columns: 1fr;
        gap: 1.35rem;
        padding: clamp(2rem, 5vw, 3rem) clamp(1.4rem, 6vw, 4.4rem) clamp(1.4rem, 4vw, 2.4rem);
        border-top: 1px solid rgba(196, 143, 57, 0.55);
        background: linear-gradient(135deg, #fffdf8, #fbf5ea);
      }

      .mobile-footer-brand-wrap {
        display: flex;
        align-items: center;
        gap: 1.3rem;
      }

      .mobile-footer-brand-icon {
        display: grid;
        place-items: center;
        width: 5.5rem;
        height: 5.5rem;
        flex: 0 0 5.5rem;
        border: 1px solid #d3a25b;
        border-radius: 1.4rem;
        background: rgba(255,255,255,.82);
        color: #c58d3b;
        font-size: 2rem;
        box-shadow: 0 8px 18px rgba(83,60,30,.1);
        overflow: hidden;
        padding: .45rem;
      }

      .mobile-footer-brand-icon img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
      }

      .mobile-footer-brand {
        font-family: var(--primary-font);
        font-size: clamp(1rem, 2.8vw, 1.6rem);
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .mobile-footer-sub {
        margin-top: 0.35rem;
        font-size: clamp(0.82rem, 2vw, 1.1rem);
        color: #c58d3b;
      }

      .mobile-footer-close-btn {
        order: 3;
        width: min(100%, 11.5rem);
        min-height: 3rem;
        justify-self: start;
        border: 1px solid #d49a3d;
        background: linear-gradient(135deg, #20242d, #11151d);
        border-radius: .55rem;
        padding: .65rem 1rem;
        color: #f4dfbd;
        font-family: var(--brand-font), Georgia, serif;
        font-size: .9rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 5px 12px rgba(22,25,32,.14);
      }

      .mobile-footer-links {
        order: 2;
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem 0.85rem;
      }

      .mobile-footer-link {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        min-height: 2.85rem;
        font-size: clamp(0.78rem, 1.8vw, 1rem);
        color: #2a2825;
        text-decoration: none;
        border: 1px solid rgba(197, 141, 59, 0.62);
        background: rgba(255, 255, 255, 0.76);
        border-radius: 999px;
        padding: 0.55rem 1rem;
      }

      .mobile-footer-link i {
        color: #c58d3b;
      }

      .mobile-footer-link:hover {
        background: rgba(198, 167, 94, 0.14);
      }

      @media (max-width: 520px) {
        #mobileMenuFullscreenOrion99 { top: 0; left: 0; width: 100vw; height: 100dvh; border-radius: 0; }
        #mobileMenuFullscreenOrion99::before { top: 1.1rem; width: 5.8rem; height: .38rem; }
        .mobile-menu-header { padding-top: 3.6rem; }
        .mobile-menu-title { font-size: 2.5rem; }
        .mobile-category-carousel { gap: .75rem; }
        .mobile-category-card { min-height: 13rem; padding: .8rem; }
        .mobile-category-arrow { top: .65rem; right: .65rem; }
        .mobile-footer-brand-icon { width: 4rem; height: 4rem; flex-basis: 4rem; border-radius: 1rem; }
        .mobile-footer-close-btn { min-height: 3rem; width: 10.5rem; }
      }

      @media (min-width: 1025px) {
        #mobileMenuFullscreenOrion99 {
          top: 50%;
          left: 50%;
          width: min(1080px, calc(100vw - 4rem));
          height: min(760px, calc(100dvh - 4rem));
          border-radius: 0;
          transform: translate(-50%, calc(-50% + .75rem));
          box-shadow: 0 0 0 100vmax rgba(11, 18, 29, .7), 0 22px 55px rgba(0, 0, 0, .22);
        }

        #mobileMenuFullscreenOrion99.is-open { transform: translate(-50%, -50%); }
        #mobileMenuFullscreenOrion99::before { display: none; }

        .mobile-menu-header {
          position: sticky;
          top: 0;
          z-index: 10;
          padding: 1.25rem 1.5rem 1rem;
          border-bottom: 1px solid rgba(45, 38, 29, .1);
          background: rgba(255, 253, 248, .96);
          backdrop-filter: blur(12px);
        }

        .mobile-menu-title {
          font-family: var(--primary-font), Arial, sans-serif;
          font-size: 1.65rem;
          font-weight: 750;
          letter-spacing: -.025em;
        }

        .mobile-menu-title::after {
          bottom: -.45rem;
          width: 1.75rem;
          height: 2px;
          box-shadow: none;
        }

        .mobile-menu-close {
          width: 2.65rem;
          height: 2.65rem;
          border-color: rgba(197, 141, 59, .5);
          font-size: 1rem;
          box-shadow: none;
        }

        .mobile-categories-section,
        .mobile-columns-section,
        #mobileLinesLevel { padding-inline: 1.5rem; }

        .mobile-category-carousel {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: .75rem;
          margin: 1rem 0 1.25rem;
        }

        .mobile-category-card {
          min-height: 12.25rem;
          padding: 1rem .75rem .85rem;
          border-radius: .45rem;
          box-shadow: 0 3px 10px rgba(65, 49, 28, .055);
        }

        .mobile-category-card:hover,
        .mobile-category-card:focus-visible {
          transform: translateY(-2px);
          box-shadow: 0 7px 18px rgba(65, 49, 28, .09);
        }

        .mobile-category-image-wrap {
          width: 6.5rem;
          height: 6.5rem;
          margin-bottom: .75rem;
          border-width: 1px;
          box-shadow: 0 4px 12px rgba(75, 52, 24, .08);
        }

        .mobile-category-fallback-icon { font-size: 2.25rem; }

        .mobile-category-name {
          max-width: 11rem;
          padding-bottom: .55rem;
          font-family: var(--primary-font), Arial, sans-serif;
          font-size: .9rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .mobile-category-name::after { width: 1.4rem; height: 1px; }

        .mobile-category-arrow {
          top: .65rem;
          right: .65rem;
          width: 1.9rem;
          height: 1.9rem;
          font-size: .72rem;
        }

        .mobile-menu-footer { gap: .8rem; padding: 1.25rem 1.5rem; }
        .mobile-footer-brand-wrap { gap: .75rem; }

        .mobile-footer-brand-icon {
          width: 2.9rem;
          height: 2.9rem;
          flex-basis: 2.9rem;
          border-radius: .5rem;
          font-size: 1rem;
          box-shadow: none;
          padding: .25rem;
        }

        .mobile-footer-brand { font-size: .9rem; }
        .mobile-footer-sub { margin-top: .15rem; font-size: .72rem; }
        .mobile-footer-links { gap: .45rem; }

        .mobile-footer-link {
          min-height: 2.15rem;
          padding: .35rem .7rem;
          font-size: .72rem;
        }

        .mobile-footer-close-btn {
          width: 10.5rem;
          min-height: 3rem;
          border-radius: .45rem;
          font-family: var(--primary-font), Arial, sans-serif;
          font-size: .9rem;
        }
      }

      @media (max-width: 1024px) {
        .desktop-header-inner { display: none !important; }
        .mobile-header-inner { display: flex !important; }
        .cart-count-badge {
          top: -7px;
          right: -9px;
          min-width: 18px;
          height: 18px;
          font-size: 0.68rem;
        }
      }

      @media (min-width: 1025px) {
        .desktop-header-inner { display: grid !important; }
        .mobile-header-inner { display: none !important; }
      }
    `;

    document.head.appendChild(style);
  }

  render() {
    const headerRoot = document.getElementById(this.containerId);
    if (!headerRoot) {
      console.error(`#${this.containerId} not found`);
      return;
    }
    const displayCurrency = getUserDisplayCurrency();

    headerRoot.innerHTML = `
      <header id="headerNebulaX92" class="header-solid">
        <div class="desktop-header-inner">
          <div class="desktop-top-row">
            <div class="desktop-logo-area">
              <a class="header-home-link" href="${this.getHomepageUrl()}" aria-label="Retour à l'accueil">
                <img id="desktopLogoImg" class="desktop-logo" src="" alt="Smart Cut Services" style="display: none;">
                <span id="desktopCompanyName" class="desktop-company-name">Smart Cut Services</span>
              </a>
            </div>
            <div id="desktopSearchBarTrigger" class="header-search-trigger desktop-search-bar" role="search">
              <i id="desktopSearchIcon" class="fas fa-search desktop-icon search-trigger"></i>
              <input id="desktopSearchInput" class="desktop-search-input" type="search" placeholder="Rechercher" autocomplete="off" aria-label="Rechercher">
          </div>
          <div class="desktop-icons">
            <select id="desktopCurrencySelector" class="currency-selector" aria-label="Devise d'affichage">
              <option value="HTG" ${displayCurrency === 'HTG' ? 'selected' : ''}>HTG</option>
              <option value="USD" ${displayCurrency === 'USD' ? 'selected' : ''}>USD</option>
            </select>
            <button id="desktopProfileIcon" class="desktop-icon-button" type="button" aria-label="Profil">
              <i class="fas fa-user desktop-icon"></i>
            </button>
            <button id="desktopCartButton" class="cart-icon-shell" type="button" aria-label="Panier">
              <i id="desktopCartIcon" class="fas fa-shopping-bag desktop-icon"></i>
              <span id="desktopCartBadge" class="cart-count-badge" aria-hidden="true">0</span>
            </button>
          </div>
        </div>
        <div class="desktop-nav-row">
          <button id="desktopAllNavBtn" class="desktop-all-button" type="button" aria-label="Afficher les catégories">
            <i class="fas fa-bars"></i>
            <span>Catégories</span>
          </button>
          <div class="desktop-nav-items">
            <a class="desktop-nav-action" href="./printing-hub.html">Imprimerie</a>
            <a class="desktop-nav-action" href="./vendor-application.html">Devenir vendeur</a>
            <a class="desktop-nav-action" href="./auto-parts.html">Auto &amp; Parts</a>
            <div class="smartsolution-menu" data-smartsolution-menu>
              <button class="smartsolution-menu__trigger" type="button" aria-expanded="false" aria-controls="smartsolution-desktop-panel">SmartSolutionTek <i class="fas fa-chevron-down smartsolution-menu__chevron" aria-hidden="true"></i></button>
              <nav id="smartsolution-desktop-panel" class="smartsolution-menu__panel" hidden aria-label="Applications SmartSolutionTek">
                <a href="./smartsolutiontek/dashboard.html?app=forms"><i class="fas fa-clipboard-list"></i> Inscriptions en ligne</a>
                <a href="./smartsolutiontek/dashboard.html?app=shops"><i class="fas fa-store"></i> Mini-boutique</a>
                <a href="./smartsolutiontek/dashboard.html?app=courses"><i class="fas fa-graduation-cap"></i> Formation en ligne</a>
                <a href="./smartsolutiontek/dashboard.html?app=services"><i class="fas fa-calendar-check"></i> Réservations</a>
                <a href="./smartsolutiontek/dashboard.html?app=food"><i class="fas fa-utensils"></i> Cuisine &amp; artisanat</a>
              </nav>
            </div>
            <a class="desktop-nav-action" href="./education.html">Smart Akademi</a>
            <a class="desktop-nav-action" href="./logiciel%20proformat/">Freelancer</a>
            <a class="desktop-nav-action" href="./health.html">Santé &amp; Pharmacie</a>
          </div>
        </div>
      </div>

      <div class="mobile-header-inner">
          <div class="mobile-top-bar">
          <div class="mobile-logo-center">
            <a class="mobile-logo-link" href="${this.getHomepageUrl()}" aria-label="Retour à l'accueil">
              <img id="mobileLogoImg" class="mobile-logo" src="" alt="Smart Cut Services" style="display: none;">
              <span id="mobileLogoText" class="mobile-logo-text">Smart Cut</span>
            </a>
          </div>
          <div id="mobileSearchBarTrigger" class="header-search-trigger mobile-search-bar" role="search">
            <i class="fas fa-search"></i>
            <input id="mobileSearchInput" class="mobile-search-input" type="search" placeholder="Rechercher" autocomplete="off" aria-label="Rechercher">
          </div>
          <div class="mobile-right-group">
            <select id="mobileCurrencySelector" class="currency-selector" aria-label="Devise d'affichage">
              <option value="HTG" ${displayCurrency === 'HTG' ? 'selected' : ''}>HTG</option>
              <option value="USD" ${displayCurrency === 'USD' ? 'selected' : ''}>USD</option>
            </select>
            <button id="mobileProfileIcon" class="mobile-icon-button" type="button" aria-label="Profil">
              <i class="fas fa-user mobile-icon"></i>
            </button>
            <button id="mobileCartButton" class="cart-icon-shell" type="button" aria-label="Panier">
              <i id="mobileCartIcon" class="fas fa-shopping-bag mobile-icon"></i>
              <span id="mobileCartBadge" class="cart-count-badge" aria-hidden="true">0</span>
            </button>
          </div>
          </div>
          <div class="mobile-nav-scroll">
            <button id="mobileNavAllBtn" class="mobile-nav-all" type="button" aria-label="Afficher les catégories">
              <i class="fas fa-bars"></i>
              <span>Catégories</span>
            </button>
            <button id="mobileNavScrollLeft" class="mobile-nav-arrow" type="button" aria-label="Voir les liens précédents" hidden><i class="fas fa-chevron-left"></i></button>
            <div class="mobile-nav-items">
              <a class="mobile-nav-item" href="./printing-hub.html">Imprimerie</a>
              <a class="mobile-nav-item" href="./vendor-application.html">Vendre</a>
              <a class="mobile-nav-item" href="./auto-parts.html">Auto &amp; Parts</a>
              <details class="mobile-smartsolution-menu">
                <summary class="mobile-nav-item">SmartSolutionTek <i class="fas fa-chevron-down smartsolution-menu__chevron" aria-hidden="true"></i></summary>
                <nav class="mobile-smartsolution-menu__panel" aria-label="Applications SmartSolutionTek">
                  <a href="./smartsolutiontek/dashboard.html?app=forms"><i class="fas fa-clipboard-list"></i> Inscriptions en ligne</a>
                  <a href="./smartsolutiontek/dashboard.html?app=shops"><i class="fas fa-store"></i> Mini-boutique</a>
                  <a href="./smartsolutiontek/dashboard.html?app=courses"><i class="fas fa-graduation-cap"></i> Formation en ligne</a>
                  <a href="./smartsolutiontek/dashboard.html?app=services"><i class="fas fa-calendar-check"></i> Réservations</a>
                  <a href="./smartsolutiontek/dashboard.html?app=food"><i class="fas fa-utensils"></i> Cuisine &amp; artisanat</a>
                </nav>
              </details>
              <a class="mobile-nav-item" href="./education.html">Smart Akademi</a>
              <a class="mobile-nav-item" href="./logiciel%20proformat/">Freelancer</a>
              <a class="mobile-nav-item" href="./health.html">Santé &amp; Pharmacie</a>
            </div>
            <button id="mobileNavScrollRight" class="mobile-nav-arrow" type="button" aria-label="Voir les liens suivants" hidden><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
      </header>

      <div id="megaPortalLux21">
        <button id="megaCloseBtn" class="mega-close-btn" aria-label="Fermer le menu">
          <i class="fas fa-times"></i>
        </button>
        <div class="mega-content">
          <div id="megaColumnsContainer" class="mega-columns-area"></div>
          <div class="mega-featured-products">
            <h3 style="font-family: var(--primary-font); font-size: 1.3rem; margin-bottom: 1rem;">Sélection Prestige</h3>
            <div id="featuredProductsGrid" class="featured-grid"></div>
          </div>
        </div>
      </div>

      <div id="mobileMenuFullscreenOrion99" role="dialog" aria-modal="true" aria-label="Catégories" aria-hidden="true">
        <div class="mobile-menu-header">
          <span class="mobile-menu-title">Catégories</span>
          <button id="closeMobileMenuBtn" class="mobile-menu-close" type="button" aria-label="Fermer le menu">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div id="mobileMenuContent">
          <div id="mobileCategoriesLevel" class="mobile-categories-section">
            <div id="mobileCategoryCarousel" class="mobile-category-carousel"></div>
          </div>

          <div id="mobileColumnsLevel" style="display: none;">
            <div style="padding: 0 1.8rem; display: flex; align-items: center; gap: 1rem;">
              <i id="mobileBackToCategoriesArrow" class="fas fa-arrow-left mobile-back-arrow"></i>
              <h3 id="mobileCurrentCategoryTitle" style="font-family: var(--primary-font); font-size: 1.4rem; font-weight: 600; margin: 0;"></h3>
            </div>
            <div id="mobileColumnsContainer" class="mobile-columns-section"></div>
            <div id="mobileFeaturedColumns" class="mobile-columns-section"></div>
          </div>

          <div id="mobileLinesLevel" style="display: none;">
            <div style="padding: 0 1.8rem; display: flex; align-items: center; gap: 1rem;">
              <i id="mobileBackToColumnsArrow" class="fas fa-arrow-left mobile-back-arrow"></i>
              <h3 id="mobileCurrentLineTitle" style="font-family: var(--primary-font); font-size: 1.4rem; font-weight: 600; margin: 0;"></h3>
            </div>
            <div id="mobileLinesContainer" class="mobile-columns-section"></div>
          </div>
        </div>

        <div class="mobile-menu-footer">
          <div class="mobile-footer-brand-wrap">
            <div class="mobile-footer-brand-icon"><img src="./logo.png" alt="Logo Smart Cut Services"></div>
            <div>
              <div class="mobile-footer-brand">Smart Cut Services</div>
              <div class="mobile-footer-sub">Service client premium</div>
            </div>
          </div>
          <button id="mobileMenuFooterCloseBtn" class="mobile-footer-close-btn" type="button">
            <i class="fas fa-times" style="margin-right: 0.55rem;"></i> Fermer
          </button>
          <div id="mobileFooterLinksContainer" class="mobile-footer-links"></div>
        </div>
      </div>
    `;

    // Réordonne les liens de service (desktop + mobile) selon les préférences.
    // Le bouton « Catégories » reste fixe : il est hors des conteneurs ciblés.
    // Uniquement sur la page d'accueil — ailleurs l'ordre des liens est figé.
    if (isHomePage()) {
      applyNavPreference(headerRoot.querySelector('.desktop-nav-items'), {
        key: MAIN_NAV_PREF_KEY,
        linkSelector: 'a.desktop-nav-action',
      });
      applyNavPreference(headerRoot.querySelector('.mobile-nav-items'), {
        key: MAIN_NAV_PREF_KEY,
        linkSelector: 'a.mobile-nav-item',
      });
    }
  }

  async init() {
    this.navbar = new Navbar({
      desktopContainerId: 'desktopCategoriesContainer',
      mobileContainerId: 'mobileNavScroll'
    });

    this.authManager = getAuthManager();
    this.authManager.addAuthChangeListener?.((user) => this.updateProfileAvatars(user));
    this.updateProfileAvatars(this.authManager.getCurrentUser?.());
    getWebsiteAnalyticsTracker().init();
    await loadCurrencySettings();

    // Singleton: n'instancie qu'une seule fois le gestionnaire panier.
    this.cartManager = getCartManager({
      imageBasePath: './'
    });
    console.info('[HEADER] Cart manager initialise', {
      hasCartManager: Boolean(this.cartManager)
    });

    getProfilePanel();

    await this.applyHeaderConfig();
    await this.loadMobileFooterLinks();
    this.setupCurrencySelectors();
    this.setupProfileActions();
    this.setupSmartSolutionMenu();
    this.setupMobileNavControls();
    this.openRequestedAuthModal();
    this.setupSearchBarInputs();
    this.setupScrollBehavior();
    this.setupCartBadge();
    this.setupHeaderLayoutSync();
    this.syncHeaderLayout();
    this.prewarmInteractivePanels();
  }

  openRequestedAuthModal() {
    const url = new URL(window.location.href);
    const mode = url.searchParams.get('auth');
    if (!['login', 'register'].includes(mode) || globalThis.__SMART_CUT_AUTH_DEEP_LINK_HANDLED__) return;

    globalThis.__SMART_CUT_AUTH_DEEP_LINK_HANDLED__ = true;
    if (!this.authManager?.isAuthenticated?.()) {
      requestAnimationFrame(() => this.authManager?.openAuthModal?.(mode));
    }

    url.searchParams.delete('auth');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  setupCurrencySelectors() {
    const selectors = [
      document.getElementById('desktopCurrencySelector'),
      document.getElementById('mobileCurrencySelector')
    ].filter(Boolean);
    const currentCurrency = getUserDisplayCurrency();

    selectors.forEach((selector) => {
      selector.value = currentCurrency;
      selector.addEventListener('change', () => {
        const selected = setUserDisplayCurrency(selector.value);
        selectors.forEach((entry) => {
          entry.value = selected;
        });
        window.location.reload();
      });
    });
  }

  setupSmartSolutionMenu() {
    const menu = document.querySelector('[data-smartsolution-menu]');
    if (!menu) return;
    const trigger = menu.querySelector('.smartsolution-menu__trigger');
    const panel = menu.querySelector('.smartsolution-menu__panel');
    let leaveTimer = null;
    const close = () => { window.clearTimeout(leaveTimer); menu.classList.remove('is-open'); trigger?.setAttribute('aria-expanded', 'false'); if (panel) panel.hidden = true; };
    const open = () => { window.clearTimeout(leaveTimer); menu.classList.add('is-open'); trigger?.setAttribute('aria-expanded', 'true'); if (panel) panel.hidden = false; };
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const opening = panel?.hidden;
      close();
      if (opening) open();
    };
    trigger?.addEventListener('click', toggle);
    if (window.matchMedia('(min-width: 1024px)').matches) {
      menu.addEventListener('mouseenter', open);
      menu.addEventListener('mouseleave', () => { leaveTimer = window.setTimeout(close, 120); });
    }
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
    document.addEventListener('click', (event) => { if (!menu.contains(event.target)) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('scroll', close, { passive: true });
  }

  setupMobileNavControls() {
    const list = document.querySelector('.mobile-nav-items');
    const left = document.getElementById('mobileNavScrollLeft');
    const right = document.getElementById('mobileNavScrollRight');
    if (!list || !left || !right) return;
    const shell = list.closest('.mobile-nav-scroll');
    const smartMenu = document.querySelector('.mobile-smartsolution-menu');
    let idleTimer = null;
    const showArrows = () => {
      shell?.classList.remove('is-idle');
      window.clearTimeout(idleTimer);
    };
    const hideArrowsAfterPause = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => shell?.classList.add('is-idle'), 2000);
    };
    const sync = () => {
      const max = Math.max(0, list.scrollWidth - list.clientWidth);
      const overflow = max > 4;
      left.hidden = !overflow || list.scrollLeft <= 4;
      right.hidden = !overflow || list.scrollLeft >= max - 4;
      if (!overflow) {
        shell?.classList.remove('is-idle');
        window.clearTimeout(idleTimer);
      }
    };
    const move = (direction) => {
      showArrows();
      list.scrollBy({ left: direction * Math.max(160, Math.round(list.clientWidth * .72)), behavior: 'smooth' });
      hideArrowsAfterPause();
    };
    left.addEventListener('click', () => move(-1));
    right.addEventListener('click', () => move(1));
    list.addEventListener('scroll', () => { showArrows(); sync(); hideArrowsAfterPause(); }, { passive: true });
    shell?.addEventListener('mouseenter', showArrows);
    window.addEventListener('scroll', () => {
      if (smartMenu) smartMenu.open = false;
    }, { passive: true });
    window.addEventListener('resize', sync);
    requestAnimationFrame(sync);
    window.setTimeout(sync, 180);
  }

  setupHeaderLayoutSync() {
    const header = document.getElementById('headerNebulaX92');
    if (!header) return;

    this.handleWindowResize = () => this.syncHeaderLayout();
    window.addEventListener('resize', this.handleWindowResize);

    if (typeof ResizeObserver !== 'undefined') {
      this.headerResizeObserver?.disconnect?.();
      this.headerResizeObserver = new ResizeObserver(() => {
        this.syncHeaderLayout();
      });
      this.headerResizeObserver.observe(header);
    }

    window.requestAnimationFrame(() => this.syncHeaderLayout());
    window.setTimeout(() => this.syncHeaderLayout(), 120);
    window.setTimeout(() => this.syncHeaderLayout(), 420);
  }

  syncHeaderLayout() {
    const root = document.getElementById(this.containerId);
    const header = document.getElementById('headerNebulaX92');
    if (!root || !header) return;

    const measuredHeight = Math.ceil(header.getBoundingClientRect().height || header.offsetHeight || 0);
    if (!measuredHeight) return;

    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    document.documentElement.style.setProperty('--header-height', `${measuredHeight}px`);
    document.documentElement.style.setProperty('--header-height-mobile', `${measuredHeight}px`);
    root.style.height = isDesktop ? `${measuredHeight}px` : '0px';
  }

  async loadMobileFooterLinks() {
    const linksContainer = document.getElementById('mobileFooterLinksContainer');
    if (!linksContainer) return;

    try {
      const infoQuery = query(collection(db, 'footerInfos'), orderBy('createdAt', 'asc'));
      const infoSnap = await getDocs(infoQuery);
      const infos = infoSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.active !== false && row.title && (row.link || row.pageId));

      if (!infos.length) {
        linksContainer.innerHTML = '';
        return;
      }

      linksContainer.innerHTML = infos.map((item) => {
        const href = this.resolveFooterLink(item);
        const isExternal = this.isExternalLink(href);
        const icon = this.getFooterInfoIcon(item.title);
        return `
          <a class="mobile-footer-link" href="${this.escapeHtml(href)}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ''}>
            <i class="${icon}" aria-hidden="true"></i>
            ${this.escapeHtml(item.title)}
          </a>
        `;
      }).join('');
    } catch (error) {
      console.error('Erreur chargement liens footer mobile:', error);
      linksContainer.innerHTML = '';
    }
  }

  getHomepageUrl() {
    return './index.html';
  }

  getFooterInfoIcon(title = '') {
    const value = String(title).toLowerCase();
    if (value.includes('mission')) return 'fas fa-compass';
    if (value.includes('vision')) return 'far fa-eye';
    if (value.includes('objectif')) return 'fas fa-chart-simple';
    if (value.includes('livraison')) return 'fas fa-truck';
    if (value.includes('remboursement')) return 'fas fa-shield-halved';
    return 'fas fa-circle-info';
  }

  resolveFooterLink(item) {
    if (item?.pageId) {
      return `./page.html?id=${encodeURIComponent(item.pageId)}`;
    }
    return item?.link || '#';
  }

  isExternalLink(href) {
    return /^https?:\/\//i.test(String(href || ''));
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async applyHeaderConfig() {
    try {
      const configRef = doc(db, 'headerConfig', 'sierraHeaderGlobal');
      const configSnap = await getDoc(configRef);

      if (!configSnap.exists()) return;

      const config = configSnap.data() || {};

      if (config.primaryColor) {
        document.documentElement.style.setProperty('--primary-color', config.primaryColor);
      }
      if (config.secondaryColor) {
        document.documentElement.style.setProperty('--secondary-color', config.secondaryColor);
      }
      if (config.accentColor) {
        document.documentElement.style.setProperty('--accent-color', config.accentColor);
      }

      const desktopLogo = document.getElementById('desktopLogoImg');
      const mobileLogo = document.getElementById('mobileLogoImg');
      const desktopCompany = document.getElementById('desktopCompanyName');
      const mobileLogoText = document.getElementById('mobileLogoText');

      if (desktopCompany) {
        desktopCompany.textContent = config.companyName || 'Smart Cut Services';
      }

      if (mobileLogoText) {
        mobileLogoText.textContent = config.companyName || 'logo';
      }

      if (config.logoUrl) {
        if (desktopLogo) {
          desktopLogo.src = config.logoUrl;
          desktopLogo.style.display = 'block';
        }
        if (mobileLogo) {
          mobileLogo.src = config.logoUrl;
          mobileLogo.style.display = 'block';
        }
        if (mobileLogoText) {
          mobileLogoText.style.display = 'none';
        }
      } else if (mobileLogoText) {
        mobileLogoText.style.display = 'inline-flex';
      }

      if (this.navbar && typeof this.navbar.applyConfig === 'function') {
        this.navbar.applyConfig(config);
      }
    } catch (error) {
      console.error('Erreur chargement config header:', error);
    }
  }

  prewarmInteractivePanels() {
    const scheduleWarmup = () => {
      const profilePanel = getProfilePanel();
      profilePanel?.prime?.().catch((error) => {
        console.error('Erreur prechargement profil:', error);
      });
      this.cartManager?.warmUpClientContext?.().catch((error) => {
        console.error('Erreur prechargement panier:', error);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(scheduleWarmup, { timeout: 1200 });
      return;
    }

    window.setTimeout(scheduleWarmup, 400);
  }

  bindResponsivePress(target, handler) {
    if (!target) return;

    let lastPointerUpAt = 0;

    target.addEventListener('pointerup', (event) => {
      lastPointerUpAt = Date.now();
      handler(event);
    });

    target.addEventListener('click', (event) => {
      if (Date.now() - lastPointerUpAt < 350) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handler(event);
    });
  }

  setupProfileActions() {
    const handleProfileClick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const panel = getProfilePanel();
      const authManager = panel?.authManager || getAuthManager();
      const isAuthenticated = authManager?.isAuthenticated?.() ?? false;
      console.info('[PROFILE_DEBUG] header-profile-click', {
        version: '20260523-6',
        authReady: authManager?.isAuthReady ?? null,
        isAuthenticated,
        authUid: authManager?.getCurrentUser?.()?.uid || null,
        route: isAuthenticated ? 'profile-page' : 'auth-modal'
      });
      if (!isAuthenticated) {
        authManager?.openAuthModal?.('login');
        return;
      }
      window.location.assign('./profil.html');
    };

    ['desktopProfileIcon', 'mobileProfileIcon'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      this.bindResponsivePress(button, handleProfileClick);
    });
  }

  updateProfileAvatars(user) {
    const buttons = [
      document.getElementById('desktopProfileIcon'),
      document.getElementById('mobileProfileIcon')
    ].filter(Boolean);
    const photoUrl = String(user?.photoURL || '').trim();
    buttons.forEach((button) => {
      const iconClass = button.id === 'mobileProfileIcon' ? 'mobile-icon' : 'desktop-icon';
      if (photoUrl) {
        button.innerHTML = '';
        const image = document.createElement('img');
        image.className = 'profile-header-avatar';
        image.src = photoUrl;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          button.innerHTML = `<i class="fas fa-user ${iconClass}"></i>`;
        }, { once: true });
        button.append(image);
        button.setAttribute('aria-label', `Profil${user?.displayName ? ` de ${user.displayName}` : ''}`);
      } else {
        button.innerHTML = `<i class="fas fa-user ${iconClass}"></i>`;
        button.setAttribute('aria-label', 'Profil');
      }
    });
  }

  setupSearchBarInputs() {
    const bindInput = (id) => {
      const input = document.getElementById(id);
      if (!input) return;

      const syncSearch = async () => {
        const searchInstance = window.__searchInstance;
        if (!searchInstance) return;

        searchInstance.open();

        const nextValue = String(input.value || '');
        window.setTimeout(() => {
          const modalInput = searchInstance.modal?.querySelector?.(`#searchInput-${searchInstance.uniqueId}`);
          if (modalInput) {
            modalInput.value = nextValue;
          }
          searchInstance.performSearch(nextValue.trim());
        }, 120);
      };

      input.addEventListener('focus', () => {
        syncSearch();
      });

      input.addEventListener('input', () => {
        syncSearch();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          syncSearch();
        }
      });
    };

    bindInput('desktopSearchInput');
    bindInput('mobileSearchInput');
  }

  setupScrollBehavior() {
    const header = document.getElementById('headerNebulaX92');
    if (!header) return;

    let lastScrollY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;

        header.classList.remove('header-transparent');
        header.classList.add('header-solid');

        if (currentScrollY > lastScrollY && currentScrollY > 150) {
          header.style.transform = 'translateY(-100%)';
          document.documentElement.classList.add('smart-header-hidden');
        } else {
          header.style.transform = 'translateY(0)';
          document.documentElement.classList.remove('smart-header-hidden');
        }

        lastScrollY = currentScrollY;
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  getCartCount() {
    if (this.cartManager && typeof this.cartManager.getTotalItems === 'function') {
      const count = this.cartManager.getTotalItems();
      console.info('[HEADER] getCartCount via cartManager', { count });
      return count;
    }

    try {
      const raw = localStorage.getItem('veltrixa_cart');
      const cart = raw ? JSON.parse(raw) : [];
      const count = Array.isArray(cart)
        ? cart.reduce((total, item) => total + (Number(item?.quantity) || 1), 0)
        : 0;
      console.info('[HEADER] getCartCount via localStorage', {
        hasRaw: Boolean(raw),
        items: Array.isArray(cart) ? cart.length : 0,
        count
      });
      return count;
    } catch (_) {
      console.warn('[HEADER] getCartCount: lecture localStorage impossible');
      return 0;
    }
  }

  updateCartBadge(count = this.getCartCount()) {
    const safeCount = Math.max(0, Number(count) || 0);
    const label = safeCount > 99 ? '99+' : String(safeCount);

    ['desktopCartBadge', 'mobileCartBadge'].forEach((id) => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = label;
      badge.style.display = safeCount > 0 ? 'inline-flex' : 'none';
    });
    console.info('[HEADER] updateCartBadge', {
      count: safeCount,
      label
    });
  }

  setupCartBadge() {
    this.updateCartBadge();
    console.info('[HEADER] setupCartBadge: listeners attaches');

    this.handleCartUpdated = (event) => {
      const nextCount = Number(event?.detail?.count);
      console.info('[HEADER] cartUpdated recu', {
        nextCount,
        detail: event?.detail || null
      });
      this.updateCartBadge(Number.isFinite(nextCount) ? nextCount : this.getCartCount());
    };

    this.handleStorageSync = (event) => {
      if (!event.key || event.key === 'veltrixa_cart') {
        console.info('[HEADER] storage sync panier', {
          key: event.key || null
        });
        this.updateCartBadge();
      }
    };

    document.addEventListener('cartUpdated', this.handleCartUpdated);
    window.addEventListener('storage', this.handleStorageSync);
  }

  destroy() {
    if (this.navbar?.destroy) this.navbar.destroy();
    if (this.handleCartUpdated) {
      document.removeEventListener('cartUpdated', this.handleCartUpdated);
    }
    if (this.handleStorageSync) {
      window.removeEventListener('storage', this.handleStorageSync);
    }
    if (this.handleWindowResize) {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    if (this.headerResizeObserver) {
      this.headerResizeObserver.disconnect();
    }
  }
}

export default SierraHeaderNebula;
