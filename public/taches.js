/**
 * public/taches.js — Filtrage des menus Police / Réclamation selon l'entreprise
 * choisie. Les infos d'un assuré restent dans son dossier : on ne propose que
 * ses polices et ses réclamations.
 * Compatible avec la politique CSP (pas de gestionnaires inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  const selEntreprise = document.getElementById('entreprise_id');
  if (!selEntreprise) return;
  const selects = document.querySelectorAll('select[data-filtre-client]');

  function filtrer() {
    const clientId = selEntreprise.value;
    selects.forEach((sel) => {
      let selectionValide = sel.value === '';
      sel.querySelectorAll('option').forEach((opt) => {
        if (!opt.value) { opt.hidden = false; return; }
        const appartient = !clientId || opt.getAttribute('data-client-id') === clientId;
        opt.hidden = !appartient;
        if (opt.value === sel.value && !appartient) selectionValide = false;
      });
      if (!selectionValide) sel.value = '';
    });
  }

  selEntreprise.addEventListener('change', filtrer);
  filtrer();
});
