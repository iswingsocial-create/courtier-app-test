/**
 * public/courriels.js — Interactions du module Courriels (aucun framework).
 * Compatible avec la politique CSP (pas de gestionnaires inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- Formulaire de compte : préremplit les serveurs selon le fournisseur ---
  const selPreconfig = document.querySelector('[data-preconfig-courriel]');
  if (selPreconfig) {
    let preconfigs = {};
    try { preconfigs = JSON.parse(selPreconfig.getAttribute('data-preconfigs') || '{}'); } catch { preconfigs = {}; }
    const note = document.getElementById('note-preconfig');
    const appliquer = () => {
      const p = preconfigs[selPreconfig.value];
      if (!p) return;
      const champs = {
        imap_hote: p.imap_hote, imap_port: p.imap_port,
        smtp_hote: p.smtp_hote, smtp_port: p.smtp_port,
      };
      for (const [nom, val] of Object.entries(champs)) {
        const el = document.querySelector(`[data-champ="${nom}"]`);
        if (el && val) el.value = val;
      }
      if (note) note.textContent = p.note || '';
    };
    selPreconfig.addEventListener('change', appliquer);
    appliquer();
  }

  // --- Rédaction : bloc IA ---
  const btnIa = document.querySelector('[data-ia-courriel]');
  const blocIa = document.getElementById('bloc-ia');
  if (btnIa && blocIa) {
    btnIa.addEventListener('click', () => {
      blocIa.hidden = !blocIa.hidden;
      if (!blocIa.hidden) {
        const dest = document.getElementById('a');
        const iaDest = document.getElementById('ia-destinataire');
        if (dest && iaDest && !iaDest.value) iaDest.value = dest.value.split('@')[0] || '';
      }
    });
  }

  const btnGenerer = document.getElementById('btn-ia-generer');
  if (btnGenerer) {
    btnGenerer.addEventListener('click', async () => {
      const statut = document.getElementById('ia-statut');
      const contexte = document.getElementById('ia-contexte').value.trim();
      const destinataire = document.getElementById('ia-destinataire').value.trim();
      const ton = document.getElementById('ia-ton').value;
      const csrf = document.querySelector('#form-courriel input[name="_csrf"]').value;
      if (!contexte) {
        statut.textContent = 'Décrivez le sujet du courriel d’abord.';
        return;
      }
      statut.textContent = 'Rédaction en cours…';
      btnGenerer.disabled = true;
      try {
        const res = await fetch('/courriels/rediger-ia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _csrf: csrf, contexte, destinataire, ton }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.erreur || 'Échec de la rédaction IA');
        document.getElementById('sujet').value = data.sujet || '';
        document.getElementById('texte').value = data.contenu || '';
        statut.textContent = data.source === 'cohere'
          ? 'Brouillon généré par l’IA (Cohere). Relisez avant d’envoyer.'
          : 'Brouillon généré (modèle local). Relisez avant d’envoyer.';
      } catch (e) {
        statut.textContent = 'Erreur : ' + e.message;
      } finally {
        btnGenerer.disabled = false;
      }
    });
  }
});
