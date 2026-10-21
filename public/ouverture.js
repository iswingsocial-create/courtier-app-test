/**
 * public/ouverture.js — « Ouvrir un dossier » :
 *  1. Dictée vocale de la page de saisie (Web Speech API, fr-CA) — même
 *     câblage que l'assistant IA ; la transcription est normalisée par
 *     public/dictee.js (nombres en lettres → chiffres, codes épelés…).
 *     Confidentialité : la transcription passe par le service vocal du
 *     navigateur (comme l'assistant) ; le texte résultant reste éditable.
 *  2. Révision : clic sur un candidat Google Maps → les champs Entreprise
 *     se remplissent et le place_id est retenu pour la création.
 * Compatible CSP (aucun gestionnaire inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Dictée vocale (page de saisie) --------------------------------------
  const btnMicro = document.getElementById('btn-micro');
  const zone = document.getElementById('texte-dicte');
  const etatMicro = document.getElementById('micro-etat');
  if (btnMicro && zone && etatMicro) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition || typeof Dictee === 'undefined') {
      btnMicro.style.display = 'none';
      etatMicro.textContent = 'Dictée vocale indisponible dans ce navigateur (essayez Chrome ou Edge) — tapez votre note, le résultat est le même.';
    } else {
      const reco = new Recognition();
      reco.lang = 'fr-CA';
      reco.interimResults = false;
      reco.maxAlternatives = 1;
      let enEcoute = false;
      btnMicro.addEventListener('click', () => {
        try {
          if (enEcoute) reco.stop();
          else reco.start();
        } catch (e) { /* déjà en écoute */ }
      });
      reco.addEventListener('start', () => {
        enEcoute = true;
        etatMicro.textContent = '🎙️ Écoute… parlez, puis cliquez à nouveau pour arrêter.';
        btnMicro.textContent = '⏹️';
        btnMicro.title = 'Arrêter la dictée';
      });
      reco.addEventListener('result', (e) => {
        const brut = e.results[0][0].transcript;
        const texte = Dictee.normaliserDictee(brut);
        zone.value = (zone.value ? zone.value + ' ' : '') + texte;
        etatMicro.textContent = '';
      });
      reco.addEventListener('end', () => {
        enEcoute = false;
        btnMicro.textContent = '🎤';
        btnMicro.title = 'Dicter (voix)';
        if (etatMicro.textContent.startsWith('🎙️')) etatMicro.textContent = '';
      });
      reco.addEventListener('error', () => {
        enEcoute = false;
        btnMicro.textContent = '🎤';
        etatMicro.textContent = 'Dictée indisponible (autorisez le micro dans le navigateur).';
      });
    }
  }

  // --- 2. Candidats Google Maps (page de révision) ------------------------------
  const champPlaceId = document.getElementById('google_place_id');
  const poser = (id, valeur) => {
    const el = document.getElementById(id);
    if (el && valeur) el.value = valeur;
  };
  document.querySelectorAll('input[name="candidat_google"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      let cand = null;
      try { cand = JSON.parse(decodeURIComponent(radio.getAttribute('data-candidat') || '')); } catch (e) { /* ignore */ }
      if (!cand) return;
      poser('ent_raison_sociale', cand.raison_sociale);
      poser('ent_adresse', cand.adresse);
      poser('ent_ville', cand.ville);
      poser('ent_province', cand.province);
      poser('ent_code_postal', cand.code_postal);
      poser('ent_telephone_entreprise', cand.telephone);
      poser('ent_site_web', cand.site_web);
      if (champPlaceId) champPlaceId.value = cand.place_id || '';
      if (cand.clientExistantId) {
        const choix = document.querySelector(`input[name="mode_entreprise"][value="existant:${cand.clientExistantId}"]`);
        if (choix) choix.checked = true;
      }
    });
  });
});
