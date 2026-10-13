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

  // Filtrage du menu assureur selon le produit choisi (formulaire police) :
  // les options de #assureur_id portent data-produits="cgl,biens" (produits offerts).
  // Si aucun assureur n'a de produits configurés, on affiche tout (comportement actuel).
  const selLigne = document.getElementById('ligne');
  const selAssureur = document.getElementById('assureur_id');
  if (selLigne && selAssureur) {
    const filtrerAssureurs = () => {
      const options = Array.from(selAssureur.options);
      const configure = options.some((o) => o.value && o.getAttribute('data-produits'));
      options.forEach((o) => {
        if (!o.value) { o.hidden = false; return; }
        if (!configure) { o.hidden = false; return; }
        const produits = (o.getAttribute('data-produits') || '').split(',').filter(Boolean);
        o.hidden = o.selected ? false : !produits.includes(selLigne.value);
      });
      const sel = selAssureur.selectedOptions[0];
      if (sel && sel.hidden) selAssureur.value = '';
    };
    selLigne.addEventListener('change', filtrerAssureurs);
    filtrerAssureurs();
  }
});
