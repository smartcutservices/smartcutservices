import { db } from './firebase-init.js?v=20260522-2';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import './search.js';
import Navbar from './navbar.js';
import { getCartManager } from './cart.js?v=20260522-2';
import { getAuthManager } from './auth.js?v=20260522-2';
import { getProfilePanel } from './profile-panel.js?v=20260522-2';
import { getWebsiteAnalyticsTracker } from './analytics-tracker.js';

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
        --primary-color: #3a4e3f;
        --secondary-color: #b89b7b;
        --accent-color: #7c3e3e;
        --primary-font: 'Cormorant Garamond', serif;
        --brand-font: 'Playfair Display', 'Cormorant Garamond', serif;
        --secondary-font: 'Manrope', sans-serif;
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
        gap: 1rem;
        min-width: 0;
        padding-top: 0.15rem;
        border-top: 1px solid rgba(184, 155, 123, 0.14);
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
      .mobile-nav-items::-webkit-scrollbar {
        display: none;
      }

      .desktop-all-button,
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
        padding: 0.65rem 0.95rem;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.12);
        color: #1f1e1c;
        font-size: 0.9rem;
        font-weight: 700;
        flex-shrink: 0;
      }

      .desktop-icons {
        display: flex;
        gap: 0.8rem;
        align-items: center;
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
        color: #8b7e6b;
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
        background: #C6A75E;
        color: #1F1E1C;
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
        gap: 0.7rem;
        overflow-x: auto;
        overflow-y: hidden;
        white-space: nowrap;
        flex-wrap: nowrap;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x;
        scrollbar-width: none;
      }

      .mobile-nav-scroll::-webkit-scrollbar {
        display: none;
      }

      .mobile-nav-all {
        padding: 0.55rem 0.9rem;
        border-radius: 999px;
        background: rgba(184, 155, 123, 0.16);
        color: #1f1e1c;
        font-size: 0.88rem;
        font-weight: 700;
        flex-shrink: 0;
        flex: 0 0 auto;
      }

      .mobile-nav-items {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex: 0 0 auto;
        flex-wrap: nowrap;
        min-width: max-content;
      }

      .mobile-nav-item {
        padding: 0.55rem 0.85rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.78);
        box-shadow: inset 0 0 0 1px rgba(184, 155, 123, 0.12);
        color: #2d2a26;
        font-size: 0.84rem;
        font-weight: 600;
        flex: 0 0 auto;
      }

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
        height: 100vh;
        background: white;
        z-index: 2000;
        display: none;
        opacity: 0;
        transition: opacity 0.4s ease;
        overflow-y: auto;
      }

      .mobile-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 1.8rem;
        border-bottom: 1px solid rgba(184, 155, 123, 0.15);
        margin-bottom: 1.5rem;
      }

      .mobile-menu-title {
        font-family: var(--primary-font);
        font-size: 1.6rem;
        font-weight: 600;
      }

      .mobile-menu-close {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid rgba(184, 155, 123, 0.35);
        background: #fff;
        font-size: 1.15rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mobile-categories-section,
      .mobile-columns-section,
      #mobileLinesLevel {
        padding: 0 1.8rem;
      }

      .mobile-category-carousel {
        display: flex;
        gap: 1.2rem;
        overflow-x: auto;
        padding-bottom: 1.2rem;
        margin-bottom: 1rem;
        scrollbar-width: none;
      }

      .mobile-category-carousel::-webkit-scrollbar {
        display: none;
      }

      .mobile-category-card {
        flex: 0 0 108px;
        text-align: center;
        cursor: pointer;
      }

      .mobile-category-image {
        width: 88px;
        height: 88px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(184, 155, 123, 0.45);
        margin: 0 auto 0.5rem;
        display: block;
      }

      .mobile-category-name {
        font-size: 0.82rem;
        line-height: 1.2;
        color: #1f1e1c;
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
        padding-bottom: 6.2rem;
      }

      .mobile-menu-footer {
        position: sticky;
        bottom: 0;
        z-index: 4;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 0.65rem 1rem;
        padding: 0.85rem 1.2rem;
        border-top: 1px solid rgba(184, 155, 123, 0.22);
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(10px);
      }

      .mobile-footer-brand {
        font-family: var(--brand-font);
        font-size: 0.92rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .mobile-footer-sub {
        font-size: 0.76rem;
        color: #6d665f;
      }

      .mobile-footer-close-btn {
        border: 1px solid rgba(184, 155, 123, 0.45);
        background: #fff;
        border-radius: 999px;
        padding: 0.52rem 0.92rem;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
      }

      .mobile-footer-links {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem 0.6rem;
      }

      .mobile-footer-link {
        font-size: 0.74rem;
        color: #2a2825;
        text-decoration: none;
        border: 1px solid rgba(184, 155, 123, 0.35);
        background: rgba(255, 255, 255, 0.9);
        border-radius: 999px;
        padding: 0.26rem 0.62rem;
      }

      .mobile-footer-link:hover {
        background: rgba(198, 167, 94, 0.14);
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
      console.error(`âŒ #${this.containerId} not found`);
      return;
    }

    headerRoot.innerHTML = `
      <header id="headerNebulaX92" class="header-solid">
        <div class="desktop-header-inner">
          <div class="desktop-top-row">
            <div class="desktop-logo-area">
              <a class="header-home-link" href="${this.getHomepageUrl()}" aria-label="Retour Ã  l'accueil">
                <img id="desktopLogoImg" class="desktop-logo" src="" alt="logo" style="display: none;">
                <span id="desktopCompanyName" class="desktop-company-name">Smart Cut Services</span>
              </a>
            </div>
            <div id="desktopSearchBarTrigger" class="header-search-trigger desktop-search-bar" role="search">
              <i id="desktopSearchIcon" class="fas fa-search desktop-icon search-trigger"></i>
              <input id="desktopSearchInput" class="desktop-search-input" type="search" placeholder="Rechercher" autocomplete="off" aria-label="Rechercher">
            </div>
          <div class="desktop-icons">
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
          <a id="desktopAllNavBtn" class="desktop-all-button" href="./catalogue.html" aria-label="Toutes les catÃ©gories">
            <i class="fas fa-bars"></i>
            <span>Toutes</span>
          </a>
          <div id="desktopCategoriesContainer" class="desktop-categories"></div>
        </div>
      </div>

      <div class="mobile-header-inner">
          <div class="mobile-top-bar">
          <div class="mobile-logo-center">
            <a class="mobile-logo-link" href="${this.getHomepageUrl()}" aria-label="Retour Ã  l'accueil">
              <img id="mobileLogoImg" class="mobile-logo" src="" alt="logo" style="display: none;">
              <span id="mobileLogoText" class="mobile-logo-text">logo</span>
            </a>
          </div>
          <div id="mobileSearchBarTrigger" class="header-search-trigger mobile-search-bar" role="search">
            <i class="fas fa-search"></i>
            <input id="mobileSearchInput" class="mobile-search-input" type="search" placeholder="Rechercher" autocomplete="off" aria-label="Rechercher">
          </div>
          <div class="mobile-right-group">
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
            <button id="mobileNavAllBtn" class="mobile-nav-all" type="button" aria-label="Toutes les catÃ©gories">
              <i class="fas fa-bars"></i>
              <span>Toutes</span>
            </button>
            <div id="mobileNavScroll" class="mobile-nav-items"></div>
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
            <h3 style="font-family: var(--primary-font); font-size: 1.3rem; margin-bottom: 1rem;">SÃ©lection Prestige</h3>
            <div id="featuredProductsGrid" class="featured-grid"></div>
          </div>
        </div>
      </div>

      <div id="mobileMenuFullscreenOrion99">
        <div class="mobile-menu-header">
          <span class="mobile-menu-title">CatÃ©gories</span>
          <button id="closeMobileMenuBtn" class="mobile-menu-close">
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
          <div>
            <div class="mobile-footer-brand">Smart Cut Services</div>
            <div class="mobile-footer-sub">Service client premium</div>
          </div>
          <button id="mobileMenuFooterCloseBtn" class="mobile-footer-close-btn" type="button">
            Fermer <i class="fas fa-times" style="margin-left: 0.35rem;"></i>
          </button>
          <div id="mobileFooterLinksContainer" class="mobile-footer-links"></div>
        </div>
      </div>
    `;
  }

  async init() {
    this.navbar = new Navbar({
      desktopContainerId: 'desktopCategoriesContainer',
      mobileContainerId: 'mobileNavScroll'
    });

    this.authManager = getAuthManager();
    getWebsiteAnalyticsTracker().init();

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
    this.setupProfileActions();
    this.setupSearchBarInputs();
    this.setupScrollBehavior();
    this.setupCartBadge();
    this.setupHeaderLayoutSync();
    this.syncHeaderLayout();
    this.prewarmInteractivePanels();
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
        return `
          <a class="mobile-footer-link" href="${href}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ''}>
            ${item.title}
          </a>
        `;
      }).join('');
    } catch (error) {
      console.error('âŒ Erreur chargement liens footer mobile:', error);
      linksContainer.innerHTML = '';
    }
  }

  getHomepageUrl() {
    return './index.html';
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
      console.error('âŒ Erreur chargement config header:', error);
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
      console.info('[PROFILE_DEBUG] header-profile-click', {
        version: '20260522-2',
        authReady: panel?.authManager?.isAuthReady ?? null,
        isAuthenticated: panel?.authManager?.isAuthenticated?.() ?? null,
        authUid: panel?.authManager?.getCurrentUser?.()?.uid || null
      });
      panel.open();
    };

    ['desktopProfileIcon', 'mobileProfileIcon'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      this.bindResponsivePress(button, handleProfileClick);
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
        } else {
          header.style.transform = 'translateY(0)';
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


