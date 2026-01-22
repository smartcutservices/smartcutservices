const CORRECT_PASSWORD = "301187";

function initSecurityOverlay() {
  anime({
    targets: '#security-overlay div',
    scale: [0.8, 1],
    opacity: [0, 1],
    duration: 600,
    easing: 'easeOutExpo'
  });
}

function checkPassword() {
  const input = document.getElementById('security-password');
  const error = document.getElementById('security-error');

  if (input.value === CORRECT_PASSWORD) {
    anime({
      targets: '#security-overlay',
      opacity: [1, 0],
      duration: 500,
      easing: 'easeInExpo',
      complete: () => {
        document.getElementById('security-overlay').remove();
        localStorage.setItem('authorized', 'true');
      }
    });
  } else {
    error.classList.remove('hidden');

    anime({
      targets: '#security-overlay div',
      translateX: [-10, 10, -10, 10, 0],
      duration: 400,
      easing: 'easeInOutSine'
    });

    input.value = "";
  }
}
