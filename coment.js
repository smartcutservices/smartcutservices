// ============= COMPOSANT COMMENTAIRES - AVEC ANIMATIONS CRÉATIVES =============
import theme from './theme-root.js';
const COMMENTS_API_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const anime = typeof window !== 'undefined' && typeof window.anime === 'function'
  ? window.anime
  : Object.assign(() => null, {
      timeline: () => ({ add() { return this; } }),
      stagger: () => 0
    });

class CommentaireComponent {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Commentaire: Container #${containerId} non trouvé`);
      return;
    }
    
    this.options = {
      ...options
    };
    
    this.theme = theme;
    this.observer = null;
    this.isVisible = false;
    this.animationPlayed = false;
    
    // Messages prédéfinis (100 messages)
    this.presetMessages = [
      "Excellente qualité, vraiment au-delà de mes attentes. Le service est impeccable et le rapport qualité-prix est excellent.",
      "Service irréprochable, je recommande vivement cette maison qui allie tradition et modernité avec brio.",
      "Un véritable plaisir de découvrir cette enseigne. Le professionnalisme et la qualité sont au rendez-vous.",
      "Rien à redire, tout était parfait de la commande à la livraison. Une expérience client exceptionnelle.",
      "Parfait du début à la fin, je suis pleinement satisfait de mon achat et du service client réactif.",
      "Je recommande vivement cette adresse, une valeur sûre dans un monde où la qualité se fait rare.",
      "Une expérience unique, digne des plus grandes maisons. Le savoir-faire est clairement au rendez-vous.",
      "Savoir-faire exceptionnel, on sent l'expertise et la passion dans chaque détail. Bravo à toute l'équipe.",
      "Très professionnel, à l'écoute et réactif. Une entreprise qui mérite vraiment d'être connue.",
      "Un grand merci pour votre sérieux et votre professionnalisme. Je reviendrai sans hésiter.",
      "Au-delà de mes attentes, je ne pensais pas trouver une telle qualité. Félicitations à toute l'équipe.",
      "Une référence dans son domaine, je ne peux que recommander les yeux fermés.",
      "Qualité supérieure, vraiment impressionné par le soin apporté à chaque détail.",
      "Livraison rapide et soignée, le produit était parfaitement emballé et conforme à la description.",
      "Emballage soigné, produit intact et livraison dans les délais. Parfait.",
      "Produits authentiques et de grande qualité, fidèles à la réputation de la maison.",
      "Service client réactif et agréable, ils ont su répondre à toutes mes questions.",
      "Je suis conquis, je ne passerai plus que par eux désormais. Une belle découverte.",
      "À la hauteur de ma réputation, cette maison tient toutes ses promesses.",
      "Exactement ce que je cherchais, je suis ravi de mon achat et du service.",
      "Rapport qualité-prix imbattable, je ne pensais pas trouver aussi bien à ce prix.",
      "Finition parfaite, on voit que chaque détail a été pensé avec soin.",
      "Très satisfait de mon achat, je recommanderai autour de moi sans hésiter.",
      "Une belle découverte que je ne manquerai pas de partager avec mes proches.",
      "Je reviendrai sans hésiter, cette première expérience m'a pleinement convaincu.",
      "Merci pour votre sérieux et votre professionnalisme, c'est trop rare de nos jours.",
      "Un travail d'orfèvre, chaque détail est parfaitement maîtrisé. Chapeau bas.",
      "Du grand art, cette maison est vraiment une référence dans son domaine.",
      "Chapeau bas, vous méritez amplement votre réputation d'excellence.",
      "Une maison de confiance, je recommande les yeux fermés à tous mes proches.",
      "Des années d'avance sur la concurrence, vous êtes clairement les meilleurs.",
      "Le luxe discret et raffiné, exactement ce que je recherchais. Merci.",
      "L'élégance à la française, un savoir-faire rare et précieux à préserver.",
      "Un savoir-faire rare, on sent l'expertise et la passion à chaque étape.",
      "La perfection incarnée, je suis bluffé par la qualité exceptionnelle.",
      "Rien à redire, tout était parfait du début à la fin. Une expérience client exemplaire.",
      "Impeccable, du début à la fin. Je recommande vivement cette adresse.",
      "Sans faute, tout était parfait. Une maison vraiment digne de confiance.",
      "Remarquable, vraiment remarquable. Je ne pensais pas trouver une telle qualité.",
      "Une valeur sûre, on peut commander les yeux fermés, vous ne serez pas déçu.",
      "Je ne peux que recommander, cette maison est vraiment au top.",
      "Exemplaire, c'est le mot qui me vient à l'esprit. Bravo à toute l'équipe.",
      "Du travail bien fait, ça change de ce qu'on voit habituellement. Merci.",
      "Un service haut de gamme, vraiment digne des plus grandes maisons.",
      "À la hauteur, vous avez su répondre à toutes mes attentes. Merci.",
      "Les plus belles années, une maison qui traverse le temps avec élégance.",
      "Un gage de qualité, on peut commander en toute confiance les yeux fermés.",
      "La référence absolue dans le domaine, bravo pour ce travail exceptionnel.",
      "Toujours aussi satisfait après toutes ces années, vous êtes les meilleurs.",
      "Merci pour ce moment, une expérience client vraiment unique et précieuse.",
      "Une réussite totale, je suis bluffé par la qualité exceptionnelle.",
      "Bravo à toute l'équipe, vous faites un travail remarquable. Continuez ainsi.",
      "Un grand professionnalisme, à l'écoute et réactif. Merci pour tout.",
      "Excellent suivi de commande, je suis ravi de cette première expérience.",
      "Commande parfaite, rien à redire. Je reviendrai sans hésiter.",
      "Délais respectés, produit conforme, service impeccable. Que demander de plus ?",
      "Produit conforme à la description, livraison rapide, service parfait.",
      "Service après-vente réactif et efficace, ils ont su résoudre mon problème rapidement.",
      "Je suis client depuis des années et toujours aussi satisfait. Une valeur sûre.",
      "Une adresse à garder précieusement, on ne trouve plus ce genre de qualité.",
      "Je recommande les yeux fermés, cette maison est vraiment exceptionnelle.",
      "C'est parfait, vraiment parfait. Rien à redire, merci pour tout.",
      "Un sans-faute, du début à la fin. Bravo à toute l'équipe.",
      "Fidèle au poste depuis toutes ces années, vous êtes vraiment les meilleurs.",
      "La qualité avant tout, c'est ce qui vous caractérise. Merci.",
      "Du sur-mesure, exactement ce que je recherchais. Un service personnalisé.",
      "Un accompagnement personnalisé, ils ont su répondre à mes besoins spécifiques.",
      "Des experts dans leur domaine, on sent la passion et le savoir-faire.",
      "Je ne suis jamais déçu, vous êtes toujours à la hauteur de mes attentes.",
      "Merci pour votre accueil chaleureux et votre professionnalisme.",
      "Très bonne expérience, je reviendrai sans hésiter. Merci à toute l'équipe.",
      "Un moment privilégié, cette maison sait recevoir ses clients avec élégance.",
      "L'excellence à la française, vous en êtes les dignes représentants.",
      "Du grand luxe, une expérience vraiment unique et mémorable.",
      "Une maison d'exception, je ne peux que recommander chaudement.",
      "Le raffinement absolu, chaque détail est parfaitement maîtrisé.",
      "Un instant rare, cette qualité devient difficile à trouver de nos jours.",
      "La perfection incarnée, je suis bluffé par tant de talent.",
      "Un service d'antan, comme on n'en fait plus. Merci pour cette parenthèse.",
      "Le temps suspendu, une expérience hors du temps vraiment précieuse.",
      "Une parenthèse enchantée, merci pour ce moment de grâce.",
      "Du jamais vu, une qualité exceptionnelle vraiment rare.",
      "Une merveille, absolument parfait du début à la fin.",
      "Absolument divin, je suis aux anges. Merci pour cette merveille.",
      "Rien de tel ailleurs, vous êtes vraiment uniques en votre genre.",
      "Une pure merveille, je ne regrette pas mon choix une seconde."
    ];
    
    // Tableau des commentaires
    this.comments = [];
    this.uniqueId = 'comment_' + Math.random().toString(36).substr(2, 9);
    this.scrollInterval = null;
    this.commentsRefreshInterval = null;
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe(() => {
      this.render(); // Re-rendre quand le thème change
    });
    
    this.init();
  }
  
  init() {
    this.initializeComments();
    this.render();
    this.subscribeToSavedComments();
    this.setupScrollAnimation();
    this.startScrolling();
    this.attachEvents();
  }
  
  initializeComments() {
    const shuffled = [...this.presetMessages].sort(() => 0.5 - Math.random());
    for (let i = 0; i < 3; i++) {
      this.comments.push({
        id: Date.now() + i,
        text: shuffled[i],
        time: this.getRandomTime(),
        type: 'preset'
      });
    }
  }
  
  getRandomTime() {
    const types = [
      { text: "il y a 30 s", min: 0.5, max: 0.5 },
      { text: "il y a 1 min", min: 1, max: 1 },
      { text: "il y a 2 min", min: 2, max: 2 },
      { text: "il y a 5 min", min: 5, max: 5 },
      { text: "il y a 10 min", min: 10, max: 10 },
      { text: "il y a 15 min", min: 15, max: 15 },
      { text: "il y a 30 min", min: 30, max: 30 },
      { text: "il y a 1 h", min: 60, max: 60 },
      { text: "il y a 2 h", min: 120, max: 120 },
      { text: "il y a 3 h", min: 180, max: 180 },
      { text: "il y a 5 h", min: 300, max: 300 },
      { text: "il y a 12 h", min: 720, max: 720 },
      { text: "hier", min: 1440, max: 1440 },
      { text: "il y a 2 j", min: 2880, max: 2880 }
    ];
    
    const randomIndex = Math.floor(Math.random() * types.length);
    return types[randomIndex].text;
  }
  
  // ============================================
  // ANIMATION AU SCROLL AVEC ANIME.JS
  // ============================================
  setupScrollAnimation() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.isVisible = true;
          this.animateEntrance();
        } else {
          this.isVisible = false;
          this.animationPlayed = false; // Reset pour la prochaine apparition
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: "0px"
    });
    
    const container = this.container.querySelector(`.comment-oldmoney-${this.uniqueId}`);
    if (container) {
      this.observer.observe(container);
    }
  }
  
  animateEntrance() {
    if (this.animationPlayed) return;
    
    const container = this.container.querySelector(`.comment-oldmoney-${this.uniqueId}`);
    const title = container.querySelector(`.comment-header-${this.uniqueId}`);
    const inputWrapper = container.querySelector(`.comment-input-wrapper-${this.uniqueId}`);
    const cards = container.querySelectorAll(`.comment-card-${this.uniqueId}`);
    
    // Animation d'entrée sobre et fluide
    anime.timeline({
      easing: 'easeOutCubic',
      complete: () => {
        this.animationPlayed = true;
      }
    })
    .add({
      targets: title,
      translateY: [14, 0],
      opacity: [0, 1],
      duration: 420,
    })
    .add({
      targets: cards,
      translateY: [16, 0],
      opacity: [0, 1],
      delay: anime.stagger(80, {start: 80}),
      duration: 460,
    }, '-=400')
    .add({
      targets: inputWrapper,
      translateY: [14, 0],
      opacity: [0, 1],
      duration: 420
    }, '-=200');
  }
  
  // Animation pour les nouveaux messages
  animateNewMessage(card) {
    anime({
      targets: card,
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 380,
      easing: 'easeOutCubic'
    });
  }
  
  // Animation pour les commentaires utilisateur
  animateUserMessage(card) {
    anime({
      targets: card,
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 420,
      easing: 'easeOutCubic'
    });
  }
  
  // Animation du bouton
  animateButton(button) {
    anime({
      targets: button,
      scale: [1, 0.95, 1],
      rotate: ['0deg', '-2deg', '2deg', '0deg'],
      backgroundColor: [
        {value: this.theme.getColors()?.background?.button, duration: 100},
        {value: this.theme.getColors()?.text?.subtitle, duration: 200},
        {value: this.theme.getColors()?.background?.button, duration: 200}
      ],
      duration: 600,
      easing: 'easeInOutQuad'
    });
  }
  
  // Animation du scroll automatique
  animateScroll(list) {
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }
  
  render() {
    const colors = this.theme.getColors();
    const fonts = this.theme.getFonts();
    const typography = this.theme.getTypography();
    
    // Couleurs selon la structure du thème
    const primaryColor = colors?.text?.title || '#0F1111';
    const secondaryColor = colors?.text?.subtitle || '#FFA41C';
    const textColor = colors?.text?.body || '#2C3E50';
    const lightBg = colors?.background?.card || '#EAEDED';
    const borderColor = colors?.background?.card ? `${colors.background.card}80` : '#d4c8bc';
    const buttonBg = colors?.background?.button || '#0F1111';
    const buttonText = colors?.text?.button || '#FFFFFF';
    
    // Polices
    const primaryFont = typography?.family || fonts?.primary || "'Amazon Ember', Arial, sans-serif";
    const secondaryFont = fonts?.secondary || "'Amazon Ember', Arial, sans-serif";
    
    // Style CSS avec les animations
    const style = document.createElement('style');
    style.textContent = `
      .comment-oldmoney-${this.uniqueId} {
        width: calc(100% - clamp(1.5rem, 6vw, 5rem));
        max-width: 1180px;
        margin: 0 auto;
        overflow: hidden;
        color: #0b1f3a;
        font-family: ${primaryFont}, Arial, sans-serif;
        transform-origin: center;
      }

      .comment-header-${this.uniqueId} {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1.25rem;
        margin-bottom: 1rem;
        padding: 0 .25rem;
      }

      .comment-title-${this.uniqueId} {
        position: relative;
        margin: 0 0 .2rem;
        color: #0b1f3a;
        font-size: clamp(1.35rem, 2.2vw, 1.75rem);
        font-weight: 750;
        letter-spacing: -.025em;
        line-height: 1.15;
      }

      .comment-title-${this.uniqueId}::after {
        content: '';
        position: absolute;
        bottom: -.3rem;
        left: 0;
        width: 1.4rem;
        height: 2px;
        border-radius: 999px;
        background: #f2b01e;
      }

      .comment-list-${this.uniqueId} {
        display: grid;
        gap: .65rem;
        width: 100%;
        margin-bottom: 1rem;
        overflow: visible;
      }

      .comment-card-${this.uniqueId} {
        position: relative;
        display: grid;
        grid-template-columns: 2.9rem minmax(0, 1fr) auto;
        align-items: center;
        gap: .9rem;
        min-height: 6.25rem;
        padding: .85rem 1.1rem;
        overflow: hidden;
        border: 1px solid #e6eaf0;
        border-left: 3px solid #0b4f93;
        border-radius: .75rem;
        background: #fff;
        box-shadow: 0 4px 12px rgba(14, 37, 67, .055);
        transition: transform .2s ease, box-shadow .2s ease;
        transform-origin: center;
        will-change: transform, opacity;
      }

      .comment-card-${this.uniqueId}:hover {
        transform: translateY(-2px);
        box-shadow: 0 7px 18px rgba(14, 37, 67, .09);
      }

      .comment-avatar-${this.uniqueId} {
        display: grid;
        place-items: center;
        width: 2.9rem;
        height: 2.9rem;
        border-radius: 50%;
        background: linear-gradient(145deg, #092b58, #06162e);
        color: #fff;
        font-size: .76rem;
        font-weight: 800;
        letter-spacing: .04em;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
      }

      .comment-card-content-${this.uniqueId} {
        display: grid;
        gap: .28rem;
        min-width: 0;
      }

      .comment-card-head-${this.uniqueId} {
        display: grid;
        justify-items: start;
        gap: .14rem;
      }

      .comment-reviewer-${this.uniqueId} {
        display: flex;
        align-items: center;
        gap: .4rem;
      }

      .comment-reviewer-${this.uniqueId} strong {
        color: #102746;
        font-size: .68rem;
        font-weight: 850;
      }

      .comment-reviewer-${this.uniqueId} span {
        color: #3f4d61;
        font-size: .64rem;
        font-weight: 800;
        letter-spacing: .045em;
        text-transform: uppercase;
      }

      .comment-card-stars-${this.uniqueId} {
        display: inline-flex;
        gap: .1rem;
        color: #f4aa18;
        font-size: .7rem;
      }

      .comment-card-text-${this.uniqueId} {
        display: -webkit-box;
        overflow: hidden;
        color: ${textColor};
        font-size: .84rem;
        font-style: normal;
        line-height: 1.42;
        text-overflow: ellipsis;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .comment-card-side-${this.uniqueId} {
        display: grid;
        align-self: stretch;
        justify-items: end;
        min-width: 5.5rem;
      }

      .comment-quote-${this.uniqueId} {
        display: none;
      }

      .comment-card-time-${this.uniqueId} {
        align-self: end;
        color: #6a7585;
        font-family: ${secondaryFont};
        font-size: .68rem;
        text-align: right;
      }

      .comment-card-time-${this.uniqueId}.just-now {
        color: #08783e;
        font-weight: 700;
      }

      .comment-form-${this.uniqueId} {
        display: grid;
        grid-template-columns: minmax(13rem, .58fr) minmax(0, 1.75fr);
        align-items: center;
        gap: 1.25rem;
        width: 100%;
        margin-top: 1rem;
        padding: 1rem 1.15rem;
        border: 1px solid #e1e7f4;
        border-radius: .75rem;
        background: #f8f9fb;
        box-shadow: 0 4px 12px rgba(14, 37, 67, .045);
        transform-origin: top;
      }

      .comment-form-intro-${this.uniqueId} {
        display: flex;
        align-items: center;
        gap: .75rem;
        padding-right: 1rem;
        border-right: 1px solid #dce3f2;
      }

      .comment-form-icon-${this.uniqueId} {
        position: relative;
        display: grid;
        place-items: center;
        width: 2.75rem;
        height: 2.75rem;
        flex: 0 0 2.75rem;
        border: 1px solid #fff;
        border-radius: 50%;
        background: #edf1ff;
        color: #0b2f62;
        font-size: .85rem;
        box-shadow: none;
      }

      .comment-form-icon-${this.uniqueId} .comment-pen-${this.uniqueId} {
        position: absolute;
        right: .2rem;
        bottom: .2rem;
        padding: .12rem;
        border-radius: 50%;
        background: #edf1ff;
        color: #f2b01e;
        font-size: .48rem;
      }

      .comment-label-${this.uniqueId} {
        display: block;
        margin-bottom: .25rem;
        color: ${primaryColor};
        font-family: ${primaryFont};
        font-size: .86rem;
        font-weight: 750;
        letter-spacing: -.015em;
        transform-origin: left;
      }

      .comment-form-help-${this.uniqueId} {
        margin: 0;
        color: #657185;
        font-size: .72rem;
        line-height: 1.35;
      }

      .comment-input-wrapper-${this.uniqueId} {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: .75rem;
        width: 100%;
        transform-origin: top;
      }

      .comment-input-${this.uniqueId} {
        width: 100%;
        min-height: 4.5rem;
        padding: .75rem .85rem;
        resize: none;
        border: 1px solid #ccd4df;
        border-radius: .75rem;
        outline: none;
        background: #fff;
        color: ${textColor};
        font-family: ${secondaryFont};
        font-size: .82rem;
        line-height: 1.4;
        transition: border-color .2s ease, box-shadow .2s ease;
      }

      .comment-input-${this.uniqueId}:focus {
        border-color: #0b5fa8;
        box-shadow: 0 0 0 3px rgba(11,95,168,.13);
      }

      .comment-input-${this.uniqueId}::placeholder {
        color: #8a94a4;
      }

      .comment-action-${this.uniqueId} {
        display: grid;
        justify-items: stretch;
        gap: .4rem;
        min-width: 10.5rem;
      }

      .comment-button-${this.uniqueId} {
        min-height: 2.8rem;
        padding: .6rem 1rem;
        border: 1px solid #e5a20c;
        border-radius: .7rem;
        background: linear-gradient(135deg, #e6a516, #ffbd2e);
        color: #081c38;
        cursor: pointer;
        font-family: ${secondaryFont};
        font-size: .8rem;
        font-weight: 800;
        white-space: nowrap;
        box-shadow: 0 4px 10px rgba(214,147,8,.18);
        transition: transform .15s ease, filter .15s ease;
      }

      .comment-button-${this.uniqueId}:hover {
        filter: brightness(.97);
        transform: translateY(-1px);
      }

      .comment-anonymous-${this.uniqueId} {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .45rem;
        color: #697589;
        font-size: .68rem;
      }
      
      .new-message-indicator-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${secondaryColor};
        margin-top: 0.5rem;
        text-align: right;
        font-style: italic;
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
      }
      
      @media (max-width: 900px) {
        .comment-form-${this.uniqueId} { grid-template-columns: 1fr; gap: .85rem; }
        .comment-form-intro-${this.uniqueId} { padding: 0 0 .75rem; border-right: 0; border-bottom: 1px solid #dce3f2; }
      }

      @media (max-width: 640px) {
        .comment-oldmoney-${this.uniqueId} { width: calc(100% - 1rem); }
        .comment-header-${this.uniqueId} { align-items: flex-start; flex-direction: column; gap: .8rem; padding: 0 .15rem; }
        .comment-card-${this.uniqueId} { grid-template-columns: 2.55rem minmax(0, 1fr); gap: .65rem; min-height: 0; padding: .8rem; }
        .comment-avatar-${this.uniqueId} { width: 2.55rem; height: 2.55rem; }
        .comment-card-side-${this.uniqueId} { grid-column: 2; grid-row: 2; display: flex; justify-content: flex-end; min-width: 0; }
        .comment-quote-${this.uniqueId} { display: none; }
        .comment-card-time-${this.uniqueId} { align-self: auto; }
        .comment-card-text-${this.uniqueId} { font-size: .8rem; -webkit-line-clamp: 3; }
        .comment-form-${this.uniqueId} { margin-top: .85rem; padding: .85rem; }
        .comment-form-icon-${this.uniqueId} { display: none; }
        .comment-input-wrapper-${this.uniqueId} { grid-template-columns: 1fr; }
        .comment-action-${this.uniqueId} { min-width: 0; }
        .comment-button-${this.uniqueId} { width: 100%; }
      }
    `;
    
    // Nettoyer les anciens styles
    const oldStyle = document.getElementById(`comment-styles-${this.uniqueId}`);
    if (oldStyle) oldStyle.remove();
    
    style.id = `comment-styles-${this.uniqueId}`;
    document.head.appendChild(style);
    
    // HTML
    this.container.innerHTML = `
      <div class="comment-oldmoney-${this.uniqueId}">
        <div class="comment-header-${this.uniqueId}">
          <div>
            <h2 class="comment-title-${this.uniqueId}">${this.escapeHtml(this.options.title || 'Avis clients')}</h2>
          </div>
        </div>

        <div class="comment-list-${this.uniqueId}" id="commentList-${this.uniqueId}">
          ${this.renderCommentList()}
        </div>
        
        <div class="comment-form-${this.uniqueId}">
          <div class="comment-form-intro-${this.uniqueId}">
            <div class="comment-form-icon-${this.uniqueId}" aria-hidden="true">
              <i class="fas fa-comment-dots"></i>
              <i class="fas fa-pen comment-pen-${this.uniqueId}"></i>
            </div>
            <div>
              <label class="comment-label-${this.uniqueId}" for="commentInput-${this.uniqueId}">Partagez votre avis</label>
              <p class="comment-form-help-${this.uniqueId}">Votre retour aide notre communauté à mieux choisir.</p>
            </div>
          </div>
          <div class="comment-input-wrapper-${this.uniqueId}">
            <textarea class="comment-input-${this.uniqueId}"
                      placeholder="${this.escapeHtml(this.options.placeholder || 'Écrivez votre message...')}"
                      id="commentInput-${this.uniqueId}"
                      maxlength="500"
                      rows="3"></textarea>
            <div class="comment-action-${this.uniqueId}">
              <button type="button" class="comment-button-${this.uniqueId}" id="sendButton-${this.uniqueId}">
                <i class="fas fa-paper-plane" aria-hidden="true"></i>
                ${this.escapeHtml(this.options.buttonText || 'Envoyer')}
              </button>
              <span class="comment-anonymous-${this.uniqueId}"><i class="fas fa-shield-halved" aria-hidden="true"></i> Message anonyme</span>
            </div>
          </div>
        </div>
        
        <div class="new-message-indicator-${this.uniqueId}" id="indicator-${this.uniqueId}" style="display: none;">
          <i class="fas fa-comment"></i> Nouveau message ajouté
        </div>
      </div>
    `;
    
    // Vérifier la visibilité initiale
    setTimeout(() => {
      const rect = this.container.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        this.animateEntrance();
      }
    }, 100);
  }
  
  renderCommentList() {
    const displayComments = this.comments.slice(-3).reverse();
    const reviewerProfiles = [
      { name: 'Mélissa', initials: 'M' },
      { name: 'Pierre', initials: 'P' },
      { name: 'Jean', initials: 'J' }
    ];
    
    return displayComments.map((comment, index) => {
      const timeClass = comment.time === "à l'instant" ? 'just-now' : '';
      const reviewer = ['user', 'database'].includes(comment.type)
        ? { name: comment.type === 'user' ? 'Vous' : 'Client Smart Cut', initials: comment.type === 'user' ? 'VO' : 'SC' }
        : reviewerProfiles[index % reviewerProfiles.length];
      
      return `
        <div class="comment-card-${this.uniqueId}" data-id="${comment.id}" data-type="${comment.type}">
          <div class="comment-avatar-${this.uniqueId}" aria-hidden="true">${reviewer.initials}</div>
          <div class="comment-card-content-${this.uniqueId}">
            <div class="comment-card-head-${this.uniqueId}">
              <div class="comment-reviewer-${this.uniqueId}">
                <strong>${reviewer.name}</strong>
                <span>Avis client</span>
              </div>
              <div class="comment-card-stars-${this.uniqueId}" aria-label="5 étoiles sur 5">${this.renderStars()}</div>
            </div>
            <div class="comment-card-text-${this.uniqueId}">${this.escapeHtml(comment.text)}</div>
          </div>
          <div class="comment-card-side-${this.uniqueId}">
            <i class="fas fa-quote-right comment-quote-${this.uniqueId}" aria-hidden="true"></i>
            <div class="comment-card-time-${this.uniqueId} ${timeClass}">${this.escapeHtml(comment.time)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderStars() {
    return '<i class="fas fa-star"></i>'.repeat(5);
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatSavedCommentTime(value) {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    if (!date || Number.isNaN(date.getTime())) return 'à l’instant';
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (elapsedSeconds < 60) return 'à l’instant';
    if (elapsedSeconds < 3600) return `il y a ${Math.floor(elapsedSeconds / 60)} min`;
    if (elapsedSeconds < 86400) return `il y a ${Math.floor(elapsedSeconds / 3600)} h`;
    const days = Math.floor(elapsedSeconds / 86400);
    return days === 1 ? 'hier' : `il y a ${days} j`;
  }

  mergeSavedAndSimulatedComments(savedComments, simulatedComments) {
    const saved = savedComments.slice(-23);
    const simulated = simulatedComments.slice(-7);
    if (!saved.length) return simulated;
    if (saved.length === 1) return [...simulated, ...saved].slice(-30);

    // Le dernier trio visible contient deux vrais avis et un message de simulation.
    return [
      ...simulated.slice(0, -1),
      ...saved.slice(0, -2),
      simulated.at(-1),
      ...saved.slice(-2)
    ].filter(Boolean).slice(-30);
  }

  subscribeToSavedComments() {
    const loadComments = async () => {
      try {
        const response = await fetch(`${COMMENTS_API_BASE}/listSiteComments?limit=30`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'comments-load-failed');
        const savedComments = (Array.isArray(payload.comments) ? payload.comments : [])
          .filter((comment) => String(comment.text || '').trim())
          .map((comment) => ({
            id: comment.id,
            text: String(comment.text || '').trim(),
            time: this.formatSavedCommentTime(comment.createdAt),
            type: 'database'
          }))
          .reverse();
        const simulatedComments = this.comments.filter((comment) => comment.type === 'preset').slice(-7);
        this.comments = this.mergeSavedAndSimulatedComments(savedComments, simulatedComments);
        this.updateCommentList(false);
      } catch (error) {
        console.warn('[COMMENTS] Chargement des avis enregistrés indisponible:', error?.message || error);
      }
    };

    loadComments();
    if (this.commentsRefreshInterval) clearInterval(this.commentsRefreshInterval);
    this.commentsRefreshInterval = setInterval(loadComments, 30000);
  }
  
  startScrolling() {
    if (this.scrollInterval) clearInterval(this.scrollInterval);
    
    this.scrollInterval = setInterval(() => {
      const randomMessage = this.presetMessages[Math.floor(Math.random() * this.presetMessages.length)];
      
      const newComment = {
        id: Date.now(),
        text: randomMessage,
        time: this.getRandomTime(),
        type: 'preset'
      };
      
      const savedComments = this.comments
        .filter((comment) => comment.type === 'database')
        .slice(-23);
      const simulatedComments = [
        ...this.comments.filter((comment) => comment.type === 'preset'),
        newComment
      ].slice(-7);

      // Les avis enregistres restent prioritaires; le flux simule ne les evince jamais.
      this.comments = this.mergeSavedAndSimulatedComments(savedComments, simulatedComments);
      
      this.updateCommentList(true); // true pour animation spéciale
      
    }, 6000);
  }
  
  updateCommentList(isAutoMessage = false) {
    const list = document.getElementById(`commentList-${this.uniqueId}`);
    if (!list) return;
    
    list.innerHTML = this.renderCommentList();
    const cards = list.querySelectorAll(`.comment-card-${this.uniqueId}`);
    if (cards.length > 0) {
      const newestCard = cards[0];
      
      if (isAutoMessage) {
        this.animateNewMessage(newestCard);
      } else {
        this.animateUserMessage(newestCard);
      }
    }
    
    this.animateScroll(list);
  }
  
  async addUserComment(text) {
    if (!text.trim()) return;
    const cleanText = text.trim().slice(0, 500);
    const input = document.getElementById(`commentInput-${this.uniqueId}`);
    const button = document.getElementById(`sendButton-${this.uniqueId}`);
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Envoi...';
    }

    try {
      const response = await fetch(`${COMMENTS_API_BASE}/submitSiteComment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: cleanText })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || payload.error || 'comment-save-failed');
      }
      if (input) input.value = '';
      this.showSubmissionIndicator(true, 'Votre message a été enregistré');
      this.subscribeToSavedComments();
    } catch (error) {
      console.error('[COMMENTS] Enregistrement impossible:', error);
      this.showSubmissionIndicator(false, 'Impossible d’enregistrer le message. Réessayez.');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = `<i class="fas fa-paper-plane" aria-hidden="true"></i> ${this.escapeHtml(this.options.buttonText || 'Envoyer')}`;
        this.animateButton(button);
      }
    }
  }

  showSubmissionIndicator(success, message) {
    const indicator = document.getElementById(`indicator-${this.uniqueId}`);
    if (indicator) {
      indicator.style.display = 'block';
      indicator.innerHTML = `<i class="fas ${success ? 'fa-check-circle' : 'fa-circle-exclamation'}"></i> ${this.escapeHtml(message)}`;
      indicator.style.color = success ? '#15803d' : '#b91c1c';
      setTimeout(() => {
        indicator.style.display = 'none';
      }, 3000);
    }
  }
  
  attachEvents() {
    const sendButton = document.getElementById(`sendButton-${this.uniqueId}`);
    const input = document.getElementById(`commentInput-${this.uniqueId}`);
    
    if (sendButton) {
      sendButton.addEventListener('click', () => this.addUserComment(input?.value || ''));
    }
    
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.addUserComment(input.value);
        }
      });
    }
  }
  
  destroy() {
    if (this.scrollInterval) clearInterval(this.scrollInterval);
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.commentsRefreshInterval) clearInterval(this.commentsRefreshInterval);
    if (this.observer) this.observer.disconnect();
    this.container.innerHTML = '';
  }
}

export default CommentaireComponent;
