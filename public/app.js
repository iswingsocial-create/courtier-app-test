/**
 * public/app.js — Micro-interactions (aucun framework).
 * Compatible avec la politique CSP (pas de gestionnaires inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  // Confirmation avant action destructive : data-confirm="message"
  document.querySelectorAll('[data-confirm]').forEach((el) => {
    const message = el.getAttribute('data-confirm');
    if (el.tagName === 'FORM') {
      el.addEventListener('submit', (e) => {
        if (!window.confirm(message)) e.preventDefault();
      });
    } else {
      el.addEventListener('click', (e) => {
        if (!window.confirm(message)) e.preventDefault();
      });
    }
  });

  // Soumission auto d'un filtre : data-autosubmit sur un <select>
  document.querySelectorAll('select[data-autosubmit]').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (sel.form) sel.form.submit();
    });
  });

  // Chargement des polices d'une entreprise :
  // <select data-polices-pour="/factures/polices-entreprise/" data-polices-cible="police_id">
  document.querySelectorAll('select[data-polices-pour]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const cible = document.getElementById(sel.getAttribute('data-polices-cible'));
      if (!cible) return;
      cible.innerHTML = '<option value="">— Aucune —</option>';
      if (!sel.value) return;
      fetch(sel.getAttribute('data-polices-pour') + encodeURIComponent(sel.value))
        .then((r) => r.json())
        .then((polices) => {
          polices.forEach((p) => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.numero_police + ' (' + p.ligne + ' — ' + p.assureur + ')';
            cible.appendChild(o);
          });
        })
        .catch(() => {});
    });
  });
});
