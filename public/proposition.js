// public/proposition.js — Bouton Imprimer de la proposition (CSP : pas de JS inline).
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-action="imprimer"]').forEach((b) => {
    b.addEventListener('click', () => window.print());
  });
});
