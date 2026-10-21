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

  // Affichage/masquage d'un bloc de formulaire : data-toggle-cible="id-du-bloc"
  document.querySelectorAll('[data-toggle-cible]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.getAttribute('data-toggle-cible'));
      if (!el) return;
      el.hidden = !el.hidden;
      if (!el.hidden) el.scrollIntoView({ block: 'nearest' });
    });
  });

  // Lignes dynamiques répétables (ex. infractions, sinistres) :
  // <div data-lignes-dynamiques data-existant='[...]'>
  //   <div class="lignes"></div>
  //   <template><div class="ligne-dynamique">…<input data-col="nom">…<button class="retirer-ligne"></button></div></template>
  //   <button class="ajouter-ligne">…</button>
  //   <input type="hidden" name="xxx_json" value="[]">
  // </div>
  // À la soumission du formulaire, les lignes sont sérialisées en JSON.
  document.querySelectorAll('[data-lignes-dynamiques]').forEach((zone) => {
    const conteneur = zone.querySelector('.lignes');
    const modele = zone.querySelector('template');
    const champ = zone.querySelector('input[type="hidden"]');
    const btnAjout = zone.querySelector('.ajouter-ligne');
    if (!conteneur || !modele || !champ || !btnAjout) return;
    const ajouterLigne = (vals) => {
      const frag = modele.content.cloneNode(true);
      const ligne = frag.querySelector('.ligne-dynamique');
      if (!ligne) return;
      if (vals) {
        ligne.querySelectorAll('[data-col]').forEach((inp) => {
          const k = inp.getAttribute('data-col');
          if (vals[k] !== undefined && vals[k] !== null) inp.value = vals[k];
        });
      }
      const btnRetirer = ligne.querySelector('.retirer-ligne');
      if (btnRetirer) btnRetirer.addEventListener('click', () => ligne.remove());
      conteneur.appendChild(frag);
    };
    btnAjout.addEventListener('click', () => ajouterLigne());
    try {
      const existant = JSON.parse(zone.getAttribute('data-existant') || '[]');
      if (Array.isArray(existant)) existant.forEach((v) => ajouterLigne(v));
    } catch (e) { /* existant invalide : on part de zéro */ }
    const form = zone.closest('form');
    if (form) {
      form.addEventListener('submit', () => {
        const lignes = [];
        conteneur.querySelectorAll('.ligne-dynamique').forEach((lig) => {
          const obj = {};
          let vide = true;
          lig.querySelectorAll('[data-col]').forEach((inp) => {
            const v = inp.value.trim();
            obj[inp.getAttribute('data-col')] = v;
            if (v) vide = false;
          });
          if (!vide) lignes.push(obj);
        });
        champ.value = JSON.stringify(lignes);
      });
    }
  });

  // Recherche dans le dictionnaire des champs (Admin → Dictionnaire) :
  // <input data-dictionnaire-recherche> filtre les lignes des tableaux
  // [data-dictionnaire-colonnes] et masque les tables sans résultat.
  const champDico = document.querySelector('[data-dictionnaire-recherche]');
  if (champDico) {
    const compteur = document.getElementById('compteur-dictionnaire');
    const filtrer = () => {
      const q = champDico.value.trim().toLowerCase();
      let nbLignes = 0, nbTables = 0;
      document.querySelectorAll('[data-dictionnaire-table]').forEach((carte) => {
        let visibles = 0;
        carte.querySelectorAll('tr[data-dictionnaire-texte]').forEach((tr) => {
          const ok = !q || tr.getAttribute('data-dictionnaire-texte').includes(q);
          tr.style.display = ok ? '' : 'none';
          if (ok) visibles++;
        });
        carte.style.display = visibles ? '' : 'none';
        if (visibles) { nbTables++; nbLignes += visibles; }
      });
      if (compteur) compteur.textContent = q ? `${nbLignes} champ(s) dans ${nbTables} table(s)` : '';
    };
    champDico.addEventListener('input', filtrer);
  }
});
