// ============= AUTH COMPONENT - GESTIONNAIRE D'AUTHENTIFICATION =============
import { auth, googleProvider, db, authReadyPromise } from './firebase-init.js?v=20260522-1';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const HAITI_DEPARTMENTS = {
  'Artibonite': ['Dessalines', 'Desdunes', 'Ennery', 'Gonaives', 'Gros-Morne', 'L Estere', 'Marmelade', 'Saint-Marc', 'Verrettes'],
  'Centre': ['Belladere', 'Cerca-Carvajal', 'Cerca-la-Source', 'Hinche', 'Lascahobas', 'Mirebalais', 'Saut-d Eau'],
  'Grand Anse': ['Anse-d Hainault', 'Beaumont', 'Chambellan', 'Dame-Marie', 'Jeremie', 'Moron'],
  'Nippes': ['Anse-a-Veau', 'Baraderes', 'Fond-des-Negres', 'Miragoane', 'Petite-Riviere-de-Nippes'],
  'Nord': ['Acul-du-Nord', 'Bahon', 'Borgne', 'Cap-Haitien', 'Grande-Riviere-du-Nord', 'Limonade', 'Milot', 'Pignon', 'Plaine-du-Nord', 'Port-Margot', 'Quartier-Morin', 'Ranquitte', 'Saint-Raphael'],
  'Nord-Est': ['Caracol', 'Ferrier', 'Fort-Liberte', 'Mombin-Crochu', 'Mont-Organise', 'Ouanaminthe', 'Perches', 'Sainte-Suzanne', 'Trou-du-Nord', 'Vallieres'],
  'Nord-Ouest': ['Anse-a-Foleur', 'Baie-de-Henne', 'Bombardopolis', 'Jean-Rabel', 'La Tortue', 'Mole-Saint-Nicolas', 'Port-de-Paix', 'Saint-Louis-du-Nord'],
  'Ouest': ['Arcahaie', 'Cabaret', 'Carrefour', 'Cite Soleil', 'Cornillon', 'Croix-des-Bouquets', 'Delmas', 'Fond-Verrettes', 'Ganthier', 'Gressier', 'Kenscoff', 'Leogane', 'Petion-Ville', 'Petit-Goave', 'Port-au-Prince', 'Tabarre'],
  'Sud': ['Aquin', 'Camp-Perrin', 'Cavaillon', 'Chantal', 'Chardonniere', 'Coteaux', 'Ile-a-Vache', 'Les Anglais', 'Les Cayes', 'Maniche', 'Port-a-Piment', 'Roche-a-Bateau', 'Saint-Jean-du-Sud', 'Tiburon', 'Torbeck'],
  'Sud-Est': ['Anse-a-Pitres', 'Bainet', 'Belle-Anse', 'Cayes-Jacmel', 'Cote-de-Fer', 'Grand-Gosier', 'Jacmel', 'La Vallee-de-Jacmel', 'Marigot', 'Thiotte']
};

class AuthManager {
  constructor(options = {}) {
    this.options = {
      onAuthChange: null,
      ...options
    };
    
    this.currentUser = null;
    this.hasAuthInitialized = false;
    this.modal = null;
    this.uniqueId = 'auth_' + Math.random().toString(36).substr(2, 9);
    this.isModalOpen = false;
    this.isModalClosing = false;
    this.modalOpenedAt = 0;
    this.isAuthReady = false;
    this.pendingGoogleRedirect = false;
    this.authChangeCallbacks = new Set();
    this.authUnsubscribe = null;
    if (typeof this.options.onAuthChange === 'function') {
      this.authChangeCallbacks.add(this.options.onAuthChange);
    }
    
    this.init();
  }
  
  init() {
    authReadyPromise
      .catch(() => {})
      .finally(async () => {
        this.isAuthReady = true;
        await this.handleRedirectResult();
      });

    // Ã‰couter les changements d'authentification
    onAuthStateChanged(auth, (user) => {
      if (!this.isAuthReady && !user) {
        console.info('[AUTH] State null ignore avant persistence');
        return;
      }

      const previousUser = this.currentUser;
      this.currentUser = user;
      const wasAuthenticated = !!previousUser && !previousUser.isAnonymous;
      const isAuthenticated = !!user && !user.isAnonymous;
      const isAnonymous = !!user?.isAnonymous;

      if (this.hasAuthInitialized) {
        if (!wasAuthenticated && isAuthenticated) {
          const label = user?.displayName || user?.email || 'utilisateur';
          this.showToast(`Connexion rÃ©ussie. Bienvenue ${label}.`, 'success');
        } else if (wasAuthenticated && !isAuthenticated) {
          this.showToast('DÃ©connexion rÃ©ussie.', 'info');
        }
      }

      this.hasAuthInitialized = true;
      
      // Ã‰mettre un Ã©vÃ©nement
      const event = new CustomEvent('authChanged', { 
        detail: { 
          user: user,
          isAuthenticated,
          isAnonymous,
          email: user?.email,
          displayName: user?.displayName,
          uid: user?.uid
        }
      });
      document.dispatchEvent(event);
      
      for (const callback of this.authChangeCallbacks) {
        try {
          callback(user);
        } catch (error) {
          console.error('[AUTH] Erreur callback auth:', error);
        }
      }
    });
  }

  addAuthChangeListener(callback) {
    if (typeof callback !== 'function') return () => {};
    this.authChangeCallbacks.add(callback);
    if (this.hasAuthInitialized) {
      try {
        callback(this.getCurrentUser());
      } catch (error) {
        console.error('[AUTH] Erreur callback auth initial:', error);
      }
    }
    return () => this.authChangeCallbacks.delete(callback);
  }
  
  // Ouvrir le modal de connexion
  openAuthModal(mode = 'login') {
    // Ã‰viter d'ouvrir plusieurs modals
    if (this.isModalOpen) {
      return;
    }
    
    this.isModalOpen = true;
    this.isModalClosing = false;
    this.modalOpenedAt = Date.now();
    
    if (this.modal) {
      this.modal.remove();
    }
    
    this.modal = document.createElement('div');
    this.modal.className = `auth-modal-${this.uniqueId}`;
    this.renderAuthModal(mode);
    document.body.appendChild(this.modal);
    this.revealAuthModal();
    
    // Forcer le style display: flex sur l'overlay
    const overlay = this.modal.querySelector('.auth-overlay');
    const container = this.modal.querySelector('.auth-container');
    if (overlay) {
      overlay.style.display = 'flex';
    }
    
    // Animation d'entrÃ©e
    setTimeout(() => {
      const container = this.modal.querySelector('.auth-container');
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }
    }, 50);
    
    document.body.style.overflow = 'hidden';
  }
  
  // Fermer le modal
  closeAuthModal() {
    if (this.isModalClosing) {
      return;
    }
    if (!this.modal) {
      this.isModalOpen = false;
      return;
    }
    this.isModalClosing = true;
    
    const overlay = this.modal.querySelector('.auth-overlay');
    const container = this.modal.querySelector('.auth-container');
    
    if (overlay) overlay.style.opacity = '0';
    if (container) {
      container.style.opacity = '0';
      container.style.transform = 'translateY(20px)';
    }
    
    setTimeout(() => {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
      this.isModalOpen = false;
      this.isModalClosing = false;
      document.body.style.overflow = '';
    }, 300);
  }

  revealAuthModal(options = {}) {
    if (!this.modal) return;

    const { immediate = false } = options;
    const overlay = this.modal.querySelector('.auth-overlay');
    const container = this.modal.querySelector('.auth-container');

    if (overlay) {
      overlay.style.display = 'flex';
    }

    const show = () => {
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }
    };

    if (immediate) {
      show();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(show);
    });
  }

  async waitForAuthReady() {
    try {
      await authReadyPromise;
    } catch (error) {
      console.warn('âš ï¸ Auth Firebase pas totalement prÃªte:', error);
    }
    this.isAuthReady = true;
  }

  shouldUseGoogleRedirect() {
    if (typeof window === 'undefined') return false;
    const touchCapable = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.matchMedia('(max-width: 1024px)').matches;
    return touchCapable || isSmallScreen;
  }

  async handleRedirectResult() {
    if (!auth) return;

    try {
      const result = await getRedirectResult(auth);
      if (!result?.user) return;

      this.pendingGoogleRedirect = false;
      await this.ensureClientProfileForGoogle(result.user);
      this.closeAuthModal();
    } catch (error) {
      this.pendingGoogleRedirect = false;
      console.error('âŒ Erreur retour Google redirect:', error);
      if (this.modal) {
        const errorDiv = this.modal.querySelector('#authError');
        if (errorDiv) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = this.getErrorMessage(error.code);
        }
      }
    }
  }
  
  // Rendre le modal d'authentification
  renderAuthModal(mode = 'login') {
    this.modal.innerHTML = `
      <div class="auth-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        z-index: 1000010;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.3s ease;
      ">
        <div class="auth-container" style="
          background: #F5F1E8;
          border-radius: 1.5rem;
          width: 100%;
          max-width: 400px;
          max-height: calc(100vh - 2rem);
          overflow-y: auto;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.3s ease;
          padding: 2rem;
        ">
          <!-- Header -->
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
          ">
            <h2 style="
              font-family: 'Cormorant Garamond', serif;
              font-size: 1.8rem;
              color: #1F1E1C;
              margin: 0;
            ">
              ${mode === 'login' ? 'Connexion' : 'Inscription'}
            </h2>
            <button class="close-auth" style="
              background: none;
              border: none;
              font-size: 1.5rem;
              cursor: pointer;
              color: #8B7E6B;
              transition: all 0.2s;
              padding: 0.5rem;
              width: 40px;
              height: 40px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 50%;
            " onmouseover="this.style.background='rgba(198,167,94,0.1)'; this.style.color='#C6A75E'" onmouseout="this.style.background='transparent'; this.style.color='#8B7E6B'">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <!-- Formulaire -->
          <form id="authForm" class="space-y-4">
            ${mode === 'register' ? `
              <div class="new-profile-fields" style="display:grid;gap:0.75rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                  <div>
                    <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Nom *</label>
                    <input type="text" id="lastName" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;" placeholder="Dupont">
                  </div>
                  <div>
                    <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Prenom *</label>
                    <input type="text" id="firstName" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;" placeholder="Jean">
                  </div>
                </div>
                <div>
                  <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Date de naissance *</label>
                  <input type="date" id="birthDate" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;">
                </div>
                <div>
                  <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Telephone *</label>
                  <input type="tel" id="newPhone" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;" placeholder="Ex: 37 00 00 00">
                </div>
                <div style="padding:0.9rem;border:1px solid rgba(198,167,94,0.25);border-radius:0.75rem;background:rgba(198,167,94,0.07);">
                  <h4 style="margin:0 0 0.75rem 0;color:#1F1E1C;font-size:1rem;">Adresse</h4>
                  ${this.renderAddressFields('register')}
                  <label style="display:flex;gap:0.5rem;align-items:flex-start;margin-top:0.75rem;color:#8B7E6B;font-size:0.9rem;">
                    <input type="checkbox" id="registerUseAsDelivery" checked style="margin-top:0.15rem;accent-color:#C6A75E;">
                    Utiliser cette adresse comme adresse de livraison
                  </label>
                </div>
              </div>
              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">Nom complet</label>
                <input type="text" id="displayName" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                " placeholder="Jean Dupont">
              </div>

              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">Ã‚ge</label>
                <input type="number" id="age" min="1" max="120" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                " placeholder="Ex: 25">
              </div>

              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">NumÃ©ro tÃ©lÃ©phone</label>
                <input type="tel" id="phone" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                " placeholder="Ex: 37 00 00 00">
              </div>

              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">Sexe</label>
                <select id="sexe" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                ">
                  <option value="">Choisir...</option>
                  <option value="Homme">Homme</option>
                  <option value="Femme">Femme</option>
                  <option value="Autre">Autre</option>
                </select>
              </div>
            ` : ''}
            
            <div>
              <label style="
                display: block;
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
                color: #8B7E6B;
              ">Email</label>
              <input type="email" id="email" required style="
                width: 100%;
                padding: 0.75rem;
                border: 1px solid rgba(198, 167, 94, 0.3);
                border-radius: 0.5rem;
                font-size: 1rem;
                background: white;
              " placeholder="email@exemple.com">
            </div>
            
            <div>
              <label style="
                display: block;
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
                color: #8B7E6B;
              ">Rentrez votre mot de passe *</label>
              <input type="password" id="password" required style="
                width: 100%;
                padding: 0.75rem;
                border: 1px solid rgba(198, 167, 94, 0.3);
                border-radius: 0.5rem;
                font-size: 1rem;
                background: white;
              " placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢">
            </div>

            ${mode === 'register' ? `
              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">Confirmez votre mot de passe *</label>
                <input type="password" id="confirmPassword" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                " placeholder="Confirmez votre mot de passe">
              </div>
            ` : ''}

            ${mode === 'login' ? `
              <div style="text-align: right;">
                <button type="button" id="forgotPassword" style="
                  background: none;
                  border: none;
                  color: #C6A75E;
                  font-size: 0.85rem;
                  cursor: pointer;
                ">Mot de passe oubliÃ© ?</button>
              </div>
            ` : ''}
            
            <button type="submit" id="submitAuth" style="
              width: 100%;
              background: #1F1E1C;
              color: #F5F1E8;
              border: 1px solid #C6A75E;
              padding: 1rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.3s;
              margin-top: 1rem;
            " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
              ${mode === 'login' ? 'Se connecter' : 'S\'inscrire'}
            </button>
          </form>
          
          <!-- SÃ©parateur -->
          <div style="
            display: flex;
            align-items: center;
            gap: 1rem;
            margin: 1.5rem 0;
          ">
            <div style="flex: 1; height: 1px; background: rgba(198, 167, 94, 0.2);"></div>
            <span style="color: #8B7E6B; font-size: 0.9rem;">ou</span>
            <div style="flex: 1; height: 1px; background: rgba(198, 167, 94, 0.2);"></div>
          </div>
          
          <!-- Bouton Google -->
          <button id="googleSignIn" style="
            width: 100%;
            background: white;
            color: #1F1E1C;
            border: 1px solid rgba(198, 167, 94, 0.3);
            padding: 1rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
          " onmouseover="this.style.background='#F5F1E8'" onmouseout="this.style.background='white'">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 20px; height: 20px;">
            <span>Continuer avec Google</span>
          </button>
          
          <!-- Footer -->
          <div style="
            margin-top: 2rem;
            text-align: center;
            border-top: 1px solid rgba(198, 167, 94, 0.2);
            padding-top: 1.5rem;
          ">
            <p style="color: #8B7E6B; margin-bottom: 0.5rem;">
              ${mode === 'login' ? 'Pas encore de compte ?' : 'DÃ©jÃ  un compte ?'}
            </p>
            <button id="switchMode" style="
              background: none;
              border: none;
              color: #C6A75E;
              font-size: 1rem;
              font-weight: 500;
              cursor: pointer;
            ">
              ${mode === 'login' ? 'CrÃ©er un compte' : 'Se connecter'}
            </button>
          </div>
          
          <!-- Message d'erreur -->
          <div id="authError" style="
            margin-top: 1rem;
            padding: 0.75rem;
            border-radius: 0.5rem;
            background: #FEE2E2;
            color: #991B1B;
            font-size: 0.9rem;
            display: none;
          "></div>
        </div>
      </div>
      
      <style>
        .auth-container {
          animation: authSlideIn 0.3s ease forwards;
          scrollbar-width: thin;
          scrollbar-color: #C6A75E rgba(198, 167, 94, 0.12);
        }

        .auth-container::-webkit-scrollbar {
          width: 6px;
        }

        .auth-container::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 999px;
        }

        .auth-container::-webkit-scrollbar-track {
          background: rgba(198, 167, 94, 0.12);
        }
        
        .auth-container input:focus {
          outline: none;
          border-color: #C6A75E;
          box-shadow: 0 0 0 2px rgba(198, 167, 94, 0.2);
        }

        .auth-container select:focus {
          outline: none;
          border-color: #C6A75E;
          box-shadow: 0 0 0 2px rgba(198, 167, 94, 0.2);
        }
        
        @keyframes authSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
    `;
    
    this.attachAuthEvents(mode);
  }

  renderAddressFields(prefix, values = {}) {
    const departments = Object.keys(HAITI_DEPARTMENTS);
    const selectedDepartment = values.department || '';
    const communes = selectedDepartment ? (HAITI_DEPARTMENTS[selectedDepartment] || []) : [];
    const departmentOptions = ['<option value="">Choisir un departement...</option>']
      .concat(departments.map((department) => `<option value="${department}" ${selectedDepartment === department ? 'selected' : ''}>${department}</option>`))
      .join('');
    const communeOptions = ['<option value="">Choisir une commune...</option>']
      .concat(communes.map((commune) => `<option value="${commune}" ${values.commune === commune ? 'selected' : ''}>${commune}</option>`))
      .join('');

    return `
      <div style="display:grid;gap:0.75rem;">
        <div>
          <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Adresse *</label>
          <input type="text" id="${prefix}Address" value="${this.escapeAttribute(values.address || '')}" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;" placeholder="Rue, numero, quartier">
        </div>
        <div>
          <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Pays *</label>
          <select id="${prefix}Country" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;">
            <option value="Haiti" selected>Haiti</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div>
            <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Departement *</label>
            <select id="${prefix}Department" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;">${departmentOptions}</select>
          </div>
          <div>
            <label style="display:block;margin-bottom:0.5rem;font-size:0.9rem;color:#8B7E6B;">Commune *</label>
            <select id="${prefix}Commune" required style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;font-size:1rem;background:white;">${communeOptions}</select>
          </div>
        </div>
      </div>
    `;
  }

  escapeAttribute(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  bindAddressSelectors(prefix) {
    const root = this.modal || document;
    const departmentSelect = root.querySelector(`#${prefix}Department`);
    const communeSelect = root.querySelector(`#${prefix}Commune`);
    if (!departmentSelect || !communeSelect) return;
    departmentSelect.addEventListener('change', () => {
      const communes = HAITI_DEPARTMENTS[departmentSelect.value] || [];
      communeSelect.innerHTML = '<option value="">Choisir une commune...</option>' + communes.map((commune) => `<option value="${commune}">${commune}</option>`).join('');
    });
  }

  collectAddress(prefix) {
    const root = this.modal || document;
    return {
      id: 'addr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      label: 'Adresse principale',
      address: root.querySelector(`#${prefix}Address`)?.value?.trim() || '',
      country: root.querySelector(`#${prefix}Country`)?.value?.trim() || 'Haiti',
      department: root.querySelector(`#${prefix}Department`)?.value?.trim() || '',
      commune: root.querySelector(`#${prefix}Commune`)?.value?.trim() || '',
      isDelivery: Boolean(root.querySelector('#registerUseAsDelivery')?.checked),
      createdAt: new Date().toISOString()
    };
  }
  
  // Attacher les Ã©vÃ©nements du modal
  attachAuthEvents(mode) {
    if (mode === 'register') {
      this.modal.querySelectorAll('#displayName, #age, #phone, #sexe').forEach((field) => {
        field.required = false;
        field.closest('div')?.remove();
      });
      this.bindAddressSelectors('register');
    }

    const closeBtn = this.modal.querySelector('.close-auth');
    const overlay = this.modal.querySelector('.auth-overlay');
    const container = this.modal.querySelector('.auth-container');
    const switchBtn = this.modal.querySelector('#switchMode');
    const form = this.modal.querySelector('#authForm');
    const forgotBtn = this.modal.querySelector('#forgotPassword');
    const googleBtn = this.modal.querySelector('#googleSignIn');
    
    container?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    container?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeAuthModal();
    });
    
    overlay.addEventListener('click', (e) => {
      if (Date.now() - this.modalOpenedAt < 250) {
        return;
      }
      if (e.target === overlay) {
        this.closeAuthModal();
      }
    });
    
    switchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.renderAuthModal(mode === 'login' ? 'register' : 'login');
      this.modalOpenedAt = Date.now();
      this.revealAuthModal({ immediate: true });
    });
    
    if (forgotBtn) {
      forgotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleForgotPassword();
      });
    }
    
    if (googleBtn) {
      googleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleGoogleSignIn();
      });
    }
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'login') {
        this.handleLogin();
      } else {
        this.handleRegister();
      }
    });
  }
  
  // GÃ©rer la connexion
  async handleLogin() {
    await this.waitForAuthReady();
    const email = this.modal.querySelector('#email').value;
    const password = this.modal.querySelector('#password').value;
    const errorDiv = this.modal.querySelector('#authError');

    if (!auth) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Firebase Auth n est pas disponible pour le moment.';
      return;
    }
    
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.info('[AUTH] Login email reussi', {
        uid: userCredential?.user?.uid || null,
        email: userCredential?.user?.email || null,
        currentUid: auth?.currentUser?.uid || null
      });
      this.closeAuthModal();
    } catch (error) {
      console.error('âŒ Erreur connexion:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // GÃ©rer l'inscription
  async handleRegister() {
    await this.waitForAuthReady();
    const email = this.modal.querySelector('#email').value;
    const password = this.modal.querySelector('#password').value;
    const confirmPassword = this.modal.querySelector('#confirmPassword')?.value || '';
    const lastName = this.modal.querySelector('#lastName')?.value?.trim();
    const firstName = this.modal.querySelector('#firstName')?.value?.trim();
    const birthDate = this.modal.querySelector('#birthDate')?.value;
    const phone = this.modal.querySelector('#newPhone')?.value?.trim();
    const address = this.collectAddress('register');
    const displayName = `${firstName || ''} ${lastName || ''}`.trim();
    const errorDiv = this.modal.querySelector('#authError');

    if (!auth) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Firebase Auth n est pas disponible pour le moment.';
      return;
    }
    if (!lastName || !firstName) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez saisir votre nom et votre prenom.';
      return;
    }
    if (!birthDate) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez saisir votre date de naissance.';
      return;
    }
    if (!phone) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez saisir votre numÃ©ro tÃ©lÃ©phone.';
      return;
    }
    if (!address.address || !address.country || !address.department || !address.commune) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez completer votre adresse.';
      return;
    }
    if (password !== confirmPassword) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      if (displayName) {
        await updateProfile(user, {
          displayName: displayName
        });
      }

      try {
        await this.saveClientProfile(user, {
          firstName,
          lastName,
          name: displayName || user.displayName || '',
          email: user.email || email,
          phone,
          birthDate,
          addresses: [address],
          defaultDeliveryAddressId: address.isDelivery ? address.id : ''
        });
      } catch (profileError) {
        console.error('âŒ Erreur sauvegarde profil client:', profileError);
        this.showToast('Compte cree, mais le profil client n a pas pu etre synchronise completement.', 'info');
      }
      
      this.closeAuthModal();
    } catch (error) {
      console.error('âŒ Erreur inscription:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }

  async saveClientProfile(user, profile = {}) {
    if (!db || !user?.uid) return;

    const now = new Date().toISOString();
    const clientRef = doc(db, 'clients', user.uid);
    const existingSnap = await getDoc(clientRef);
    const existing = existingSnap.exists() ? existingSnap.data() : {};
    const incomingAddresses = Array.isArray(profile.addresses) ? profile.addresses : [];
    const existingAddresses = Array.isArray(existing.addresses) ? existing.addresses : [];
    const addresses = incomingAddresses.length > 0 ? incomingAddresses : existingAddresses;
    const defaultDeliveryAddressId = profile.defaultDeliveryAddressId
      || existing.defaultDeliveryAddressId
      || addresses.find((address) => address?.isDelivery)?.id
      || addresses[0]?.id
      || '';
    const defaultAddress = addresses.find((address) => address?.id === defaultDeliveryAddressId) || addresses[0] || {};
    const firstName = profile.firstName || existing.firstName || '';
    const lastName = profile.lastName || existing.lastName || '';
    const name = profile.name || existing.name || `${firstName} ${lastName}`.trim() || user.displayName || '';
    const payload = {
      uid: user.uid,
      firstName,
      lastName,
      name,
      email: profile.email || existing.email || user.email || '',
      birthDate: profile.birthDate || existing.birthDate || '',
      phone: profile.phone || existing.phone || '',
      addresses,
      defaultDeliveryAddressId,
      address: defaultAddress.address || existing.address || '',
      country: defaultAddress.country || existing.country || 'Haiti',
      department: defaultAddress.department || existing.department || '',
      commune: defaultAddress.commune || existing.commune || '',
      city: defaultAddress.commune || existing.city || '',
      createdAt: existing.createdAt || now,
      updatedAt: now
    };

    await setDoc(clientRef, payload, { merge: true });
  }
  
  // GÃ©rer la connexion avec Google
  async handleGoogleSignIn() {
    const errorDiv = this.modal.querySelector('#authError');
    await this.waitForAuthReady();

    if (!auth || !googleProvider) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Connexion Google indisponible pour le moment.';
      return;
    }
    
    try {
      if (this.shouldUseGoogleRedirect()) {
        this.pendingGoogleRedirect = true;
        this.showToast('Redirection vers Google...', 'info');
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      const result = await signInWithPopup(auth, googleProvider);
      await this.ensureClientProfileForGoogle(result.user);
      this.closeAuthModal();
    } catch (error) {
      console.error('âŒ Erreur Google:', error);
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request') {
        try {
          this.pendingGoogleRedirect = true;
          this.showToast('Popup Google bloquee. Redirection en cours...', 'info');
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          console.error('âŒ Erreur fallback Google redirect:', redirectError);
          errorDiv.style.display = 'block';
          errorDiv.textContent = this.getErrorMessage(redirectError.code);
          return;
        }
      }
      errorDiv.style.display = 'block';
      if (error?.message === 'profile_incomplete') {
        errorDiv.textContent = 'Profil incomplet. Connexion annulÃ©e.';
      } else {
        errorDiv.textContent = this.getErrorMessage(error.code);
      }
    }
  }

  async ensureClientProfileForGoogle(user) {
    if (!db || !user?.uid) return;

    const clientRef = doc(db, 'clients', user.uid);
    const clientSnap = await getDoc(clientRef);
    const existing = clientSnap.exists() ? clientSnap.data() : {};

    const hasName = Boolean((existing.firstName || '').trim() && (existing.lastName || '').trim());
    const hasBirthDate = typeof existing.birthDate === 'string' && existing.birthDate.trim() !== '';
    const hasPhone = typeof existing.phone === 'string' && existing.phone.trim() !== '';
    const hasAddress = Array.isArray(existing.addresses)
      && existing.addresses.some((address) => address?.address && address?.country && address?.department && address?.commune);

    if (hasName && hasBirthDate && hasPhone && hasAddress) {
      await this.saveClientProfile(user, {
        name: existing.name || user.displayName || '',
        email: existing.email || user.email || ''
      });
      return;
    }

    const completion = await this.requestAdditionalProfileData(existing);
    if (!completion) {
      await signOut(auth);
      throw new Error('profile_incomplete');
    }

    await this.saveClientProfile(user, {
      firstName: completion.firstName,
      lastName: completion.lastName,
      name: `${completion.firstName || ''} ${completion.lastName || ''}`.trim() || existing.name || user.displayName || '',
      email: existing.email || user.email || '',
      birthDate: completion.birthDate,
      phone: completion.phone,
      addresses: [completion.address],
      defaultDeliveryAddressId: completion.address?.isDelivery ? completion.address.id : ''
    });
  }

  requestAdditionalProfileData(existing = {}) {
    return this.requestRequiredClientData(existing);
  }

  requestRequiredClientData(existing = {}) {
    const existingAddress = Array.isArray(existing.addresses) ? existing.addresses[0] || {} : {};
    const nameParts = String(existing.name || '').trim().split(/\s+/).filter(Boolean);
    const firstNameValue = existing.firstName || nameParts.slice(0, -1).join(' ') || nameParts[0] || '';
    const lastNameValue = existing.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');
    const birthDateValue = typeof existing.birthDate === 'string' ? existing.birthDate : '';
    const phoneValue = typeof existing.phone === 'string' ? existing.phone : '';

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      overlay.innerHTML = `
        <div style="width:100%;max-width:460px;max-height:90vh;overflow:auto;background:#F5F1E8;border-radius:1rem;box-shadow:0 20px 40px rgba(0,0,0,0.25);padding:1.25rem;">
          <h3 style="margin:0 0 0.35rem 0;font-size:1.2rem;color:#1F1E1C;">Completer votre profil</h3>
          <p style="margin:0 0 1rem 0;color:#8B7E6B;font-size:0.9rem;">Nom, date de naissance, telephone et adresse sont requis.</p>

          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <div>
              <label style="display:block;margin-bottom:0.3rem;color:#8B7E6B;font-size:0.9rem;">Nom *</label>
              <input id="googleExtraLastName" type="text" value="${this.escapeAttribute(lastNameValue)}" style="width:100%;padding:0.7rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:#fff;">
            </div>
            <div>
              <label style="display:block;margin-bottom:0.3rem;color:#8B7E6B;font-size:0.9rem;">Prenom *</label>
              <input id="googleExtraFirstName" type="text" value="${this.escapeAttribute(firstNameValue)}" style="width:100%;padding:0.7rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:#fff;">
            </div>
            <div>
              <label style="display:block;margin-bottom:0.3rem;color:#8B7E6B;font-size:0.9rem;">Date de naissance *</label>
              <input id="googleExtraBirthDate" type="date" value="${this.escapeAttribute(birthDateValue)}" style="width:100%;padding:0.7rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:#fff;">
            </div>
            <div>
              <label style="display:block;margin-bottom:0.3rem;color:#8B7E6B;font-size:0.9rem;">Telephone *</label>
              <input id="googleExtraPhone" type="tel" value="${this.escapeAttribute(phoneValue)}" style="width:100%;padding:0.7rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:#fff;">
            </div>
            ${this.renderAddressFields('googleExtra', existingAddress)}
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <input type="checkbox" id="googleExtraUseAsDelivery" checked style="accent-color:#C6A75E;">
              <label for="googleExtraUseAsDelivery" style="color:#8B7E6B;font-size:0.9rem;">Utiliser cette adresse comme adresse de livraison</label>
            </div>
          </div>

          <div id="googleExtraError" style="display:none;margin-top:0.8rem;padding:0.6rem;border-radius:0.5rem;background:#FEE2E2;color:#991B1B;font-size:0.85rem;"></div>

          <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1rem;">
            <button type="button" id="googleExtraCancel" style="padding:0.65rem 0.9rem;border:1px solid rgba(198,167,94,0.4);background:#fff;color:#1F1E1C;border-radius:0.5rem;cursor:pointer;">Annuler</button>
            <button type="button" id="googleExtraSave" style="padding:0.65rem 0.9rem;border:none;background:#1F1E1C;color:#F5F1E8;border-radius:0.5rem;cursor:pointer;">Enregistrer</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const previousModal = this.modal;
      this.modal = overlay;
      this.bindAddressSelectors('googleExtra');
      this.modal = previousModal;

      const showError = (message) => {
        const errorDiv = overlay.querySelector('#googleExtraError');
        errorDiv.style.display = 'block';
        errorDiv.textContent = message;
      };
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      overlay.querySelector('#googleExtraCancel')?.addEventListener('click', () => close(null));
      overlay.querySelector('#googleExtraSave')?.addEventListener('click', () => {
        const firstName = overlay.querySelector('#googleExtraFirstName')?.value?.trim() || '';
        const lastName = overlay.querySelector('#googleExtraLastName')?.value?.trim() || '';
        const birthDate = overlay.querySelector('#googleExtraBirthDate')?.value || '';
        const phone = overlay.querySelector('#googleExtraPhone')?.value?.trim() || '';
        const previousModalForCollect = this.modal;
        this.modal = overlay;
        const address = this.collectAddress('googleExtra');
        this.modal = previousModalForCollect;
        address.isDelivery = Boolean(overlay.querySelector('#googleExtraUseAsDelivery')?.checked);

        if (!lastName || !firstName) return showError('Veuillez saisir votre nom et votre prenom.');
        if (!birthDate) return showError('Veuillez saisir votre date de naissance.');
        if (!phone) return showError('Veuillez saisir votre numero telephone.');
        if (!address.address || !address.country || !address.department || !address.commune) return showError('Veuillez completer votre adresse.');

        close({ firstName, lastName, birthDate, phone, address });
      });
    });

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        z-index: 1000002;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      `;

      const defaultAge = Number(existing.age);
      const ageValue = Number.isFinite(defaultAge) && defaultAge > 0 ? String(defaultAge) : '';
      const sexeValue = typeof existing.sexe === 'string' ? existing.sexe : '';
      const phoneValue = typeof existing.phone === 'string' ? existing.phone : '';

      overlay.innerHTML = `
        <div style="
          width: 100%;
          max-width: 420px;
          background: #F5F1E8;
          border-radius: 1rem;
          box-shadow: 0 20px 40px rgba(0,0,0,0.25);
          padding: 1.25rem;
        ">
          <h3 style="margin:0 0 0.35rem 0; font-size:1.2rem; color:#1F1E1C;">ComplÃ©ter votre profil</h3>
          <p style="margin:0 0 1rem 0; color:#8B7E6B; font-size:0.9rem;">Ã‚ge, sexe et tÃ©lÃ©phone sont requis.</p>

          <div style="display:flex; flex-direction:column; gap:0.75rem;">
            <div>
              <label style="display:block; margin-bottom:0.3rem; color:#8B7E6B; font-size:0.9rem;">Ã‚ge</label>
              <input id="googleExtraAge" type="number" min="1" max="120" value="${ageValue}" style="width:100%; padding:0.7rem; border:1px solid rgba(198, 167, 94, 0.3); border-radius:0.5rem; background:#fff;">
            </div>
            <div>
              <label style="display:block; margin-bottom:0.3rem; color:#8B7E6B; font-size:0.9rem;">NumÃ©ro tÃ©lÃ©phone</label>
              <input id="googleExtraPhone" type="tel" value="${phoneValue}" style="width:100%; padding:0.7rem; border:1px solid rgba(198, 167, 94, 0.3); border-radius:0.5rem; background:#fff;">
            </div>
            <div>
              <label style="display:block; margin-bottom:0.3rem; color:#8B7E6B; font-size:0.9rem;">Sexe</label>
              <select id="googleExtraSexe" style="width:100%; padding:0.7rem; border:1px solid rgba(198, 167, 94, 0.3); border-radius:0.5rem; background:#fff;">
                <option value="">Choisir...</option>
                <option value="Homme" ${sexeValue === 'Homme' ? 'selected' : ''}>Homme</option>
                <option value="Femme" ${sexeValue === 'Femme' ? 'selected' : ''}>Femme</option>
                <option value="Autre" ${sexeValue === 'Autre' ? 'selected' : ''}>Autre</option>
              </select>
            </div>
          </div>

          <div id="googleExtraError" style="display:none; margin-top:0.8rem; padding:0.6rem; border-radius:0.5rem; background:#FEE2E2; color:#991B1B; font-size:0.85rem;"></div>

          <div style="display:flex; gap:0.6rem; justify-content:flex-end; margin-top:1rem;">
            <button type="button" id="googleExtraCancel" style="padding:0.65rem 0.9rem; border:1px solid rgba(198, 167, 94, 0.4); background:#fff; color:#1F1E1C; border-radius:0.5rem; cursor:pointer;">Annuler</button>
            <button type="button" id="googleExtraSave" style="padding:0.65rem 0.9rem; border:none; background:#1F1E1C; color:#F5F1E8; border-radius:0.5rem; cursor:pointer;">Enregistrer</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const ageInput = overlay.querySelector('#googleExtraAge');
      const phoneInput = overlay.querySelector('#googleExtraPhone');
      const sexeInput = overlay.querySelector('#googleExtraSexe');
      const errorDiv = overlay.querySelector('#googleExtraError');
      const cancelBtn = overlay.querySelector('#googleExtraCancel');
      const saveBtn = overlay.querySelector('#googleExtraSave');

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      cancelBtn.addEventListener('click', () => close(null));
      saveBtn.addEventListener('click', () => {
        const ageParsed = parseInt(ageInput.value, 10);
        const phone = phoneInput.value.trim();
        const sexe = sexeInput.value.trim();

        if (!Number.isInteger(ageParsed) || ageParsed < 1 || ageParsed > 120) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = 'Veuillez saisir un Ã¢ge valide (1-120).';
          return;
        }
        if (!phone) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = 'Veuillez saisir votre numÃ©ro tÃ©lÃ©phone.';
          return;
        }
        if (!sexe) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = 'Veuillez sÃ©lectionner votre sexe.';
          return;
        }

        close({ age: ageParsed, phone, sexe });
      });
    });
  }
  
  // GÃ©rer le mot de passe oubliÃ©
  async handleForgotPassword() {
    const email = this.modal.querySelector('#email').value;
    const errorDiv = this.modal.querySelector('#authError');
    
    if (!email) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez saisir votre email';
      return;
    }
    
    try {
      await sendPasswordResetEmail(auth, email);
      this.showToast('Email de rÃ©initialisation envoyÃ©. VÃ©rifiez votre boÃ®te de rÃ©ception.', 'success');
      this.closeAuthModal();
    } catch (error) {
      console.error('âŒ Erreur:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // Traduire les erreurs Firebase
  getErrorMessage(code) {
    const messages = {
      'auth/user-not-found': 'Aucun compte trouvÃ© avec cet email',
      'auth/wrong-password': 'Mot de passe incorrect',
      'auth/email-already-in-use': 'Cet email est dÃ©jÃ  utilisÃ©',
      'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractÃ¨res',
      'auth/invalid-email': 'Email invalide',
      'auth/too-many-requests': 'Trop de tentatives. RÃ©essayez plus tard',
      'auth/network-request-failed': 'Erreur rÃ©seau. VÃ©rifiez votre connexion',
      'auth/operation-not-allowed': 'La mÃ©thode email/mot de passe ou Google n est pas active dans Firebase Auth.',
      'auth/invalid-credential': 'Identifiants invalides ou compte inexistant.',
      'auth/unauthorized-domain': 'Ce domaine n est pas autorise dans Firebase Auth. Ajoutez-le dans les domaines autorises.',
      'auth/account-exists-with-different-credential': 'Un compte existe deja avec cet email via une autre methode de connexion.',
      'auth/popup-closed-by-user': 'FenÃªtre de connexion fermÃ©e',
      'auth/cancelled-popup-request': 'Connexion annulÃ©e',
      'auth/popup-blocked': 'La popup a Ã©tÃ© bloquÃ©e par le navigateur',
      'permission-denied': 'La sauvegarde du profil client a Ã©tÃ© refusÃ©e par les rÃ¨gles Firestore.',
      'unavailable': 'Service temporairement indisponible. RÃ©essayez dans un instant.'
    };
    return messages[code] || 'Une erreur est survenue. Veuillez rÃ©essayer.';
  }
  
  // DÃ©connexion
  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('âŒ Erreur dÃ©connexion:', error);
    }
  }
  
  // Obtenir l'utilisateur courant
  getCurrentUser() {
    return this.currentUser || auth?.currentUser || null;
  }
  
  // VÃ©rifier si l'utilisateur est connectÃ©
  isAuthenticated() {
    const user = this.getCurrentUser();
    return !!user && !user.isAnonymous;
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bg = type === 'error'
      ? '#7F1D1D'
      : type === 'info'
        ? '#1F2937'
        : '#14532D';

    toast.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 1rem;
      transform: translateX(-50%) translateY(20px);
      background: ${bg};
      color: #F8F5EF;
      padding: 0.8rem 1rem;
      border-radius: 0.75rem;
      border: 1px solid rgba(255,255,255,0.2);
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      z-index: 1000001;
      font-size: 0.9rem;
      max-width: min(92vw, 460px);
      width: max-content;
      opacity: 0;
      transition: opacity 0.22s ease, transform 0.22s ease;
      text-align: center;
      line-height: 1.35;
    `;
    toast.textContent = message;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(16px)';
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }
}

let authInstance = null;
const AUTH_MANAGER_KEY = '__SMART_CUT_AUTH_MANAGER__';

export function getAuthManager(options = {}) {
  if (globalThis[AUTH_MANAGER_KEY]) {
    authInstance = globalThis[AUTH_MANAGER_KEY];
    if (typeof options.onAuthChange === 'function') {
      authInstance.addAuthChangeListener(options.onAuthChange);
    }
    return authInstance;
  }

  if (!authInstance) {
    authInstance = new AuthManager(options);
    globalThis[AUTH_MANAGER_KEY] = authInstance;
  } else if (typeof options.onAuthChange === 'function') {
    authInstance.addAuthChangeListener(options.onAuthChange);
  }
  return authInstance;
}

export default AuthManager;

