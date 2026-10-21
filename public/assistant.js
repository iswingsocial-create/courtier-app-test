/**
 * public/assistant.js — Chat de l'assistant IA : envoi en fetch (JSON + CSRF),
 * dictée vocale via l'API Web Speech du navigateur (Chrome/Edge, français).
 * Compatible avec la politique CSP (aucun gestionnaire inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const zone = document.getElementById('chat-messages');
  const csrf = document.getElementById('csrf').value;
  const btnMicro = document.getElementById('btn-micro');
  const etatMicro = document.getElementById('micro-etat');

  function defiler() { zone.scrollTop = zone.scrollHeight; }
  defiler();

  function bulle(texte, classe) {
    const d = document.createElement('div');
    d.className = 'chat-bulle pre-ligne ' + classe;
    d.textContent = texte;
    zone.appendChild(d);
    defiler();
    return d;
  }

  function bulleConfirmation(bulleEl, confirmation) {
    // Remplace le contenu de la bulle d'attente par le résumé + boutons.
    bulleEl.textContent = '';
    const p = document.createElement('p');
    p.textContent = confirmation.resume;
    p.style.margin = '0 0 8px';
    bulleEl.appendChild(p);
    const ligne = document.createElement('div');
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'btn';
    btnOk.textContent = '✓ Confirmer';
    const btnNon = document.createElement('button');
    btnNon.type = 'button';
    btnNon.className = 'btn btn-secondaire';
    btnNon.textContent = 'Annuler';
    btnNon.style.marginLeft = '8px';
    ligne.appendChild(btnOk);
    ligne.appendChild(btnNon);
    bulleEl.appendChild(ligne);
    btnOk.addEventListener('click', async () => {
      btnOk.disabled = true;
      btnNon.disabled = true;
      try {
        const res = await fetch('/assistant/confirmer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commande: confirmation.commande, _csrf: csrf }),
        });
        const data = await res.json();
        bulleEl.textContent = data.reponse || data.erreur || 'Erreur inattendue.';
      } catch (err) {
        bulleEl.textContent = 'Erreur de connexion. Réessayez.';
      }
      defiler();
    });
    btnNon.addEventListener('click', () => {
      bulleEl.textContent = "Très bien, je n'ai rien modifié.";
      defiler();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texte = input.value.trim();
    if (!texte) return;
    input.value = '';
    bulle(texte, 'chat-utilisateur');
    const attente = bulle('…', 'chat-assistant');
    try {
      const res = await fetch('/assistant/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texte, _csrf: csrf }),
      });
      const data = await res.json();
      if (data.confirmation) {
        bulleConfirmation(attente, data.confirmation);
      } else {
        attente.textContent = data.reponse || data.erreur || 'Erreur inattendue.';
        if (data.redirection) {
          setTimeout(() => { window.location.href = data.redirection; }, 900);
        }
      }
    } catch (err) {
      attente.textContent = 'Erreur de connexion. Réessayez.';
    }
    defiler();
  });

  // --- Dictée vocale -----------------------------------------------------------
  // Web Speech API du navigateur (Chrome/Edge/Safari, français canadien).
  // Confidentialité : la transcription passe par le service vocal du
  // navigateur (Google/Apple selon le navigateur). Une transcription 100 %
  // locale (Whisper auto-hébergé) est prévue comme option au déploiement VPS.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition || typeof Dictee === 'undefined') {
    btnMicro.style.display = 'none';
    etatMicro.textContent = 'Dictée vocale indisponible dans ce navigateur (essayez Chrome ou Edge).';
    return;
  }
  const reco = new Recognition();
  reco.lang = 'fr-CA';
  reco.interimResults = false;
  reco.maxAlternatives = 1;
  let enEcoute = false;

  btnMicro.addEventListener('click', () => {
    try {
      if (enEcoute) {
        reco.stop(); // l'événement « end » réinitialise l'interface
      } else {
        reco.start();
      }
    } catch (e) { /* déjà en écoute */ }
  });
  reco.addEventListener('start', () => {
    enEcoute = true;
    etatMicro.textContent = '🎙️ Écoute… parlez, puis cliquez à nouveau pour arrêter.';
    btnMicro.disabled = false;
    btnMicro.textContent = '⏹️';
    btnMicro.title = 'Arrêter la dictée';
  });
  reco.addEventListener('result', (e) => {
    const brut = e.results[0][0].transcript;
    // Normalisation : nombres en lettres → chiffres, codes épelés → chiffres.
    const texte = Dictee.normaliserDictee(brut);
    input.value = (input.value ? input.value + ' ' : '') + texte;
    etatMicro.textContent = '';
  });
  reco.addEventListener('end', () => {
    enEcoute = false;
    btnMicro.disabled = false;
    btnMicro.textContent = '🎤';
    btnMicro.title = 'Dicter (voix)';
    if (etatMicro.textContent.startsWith('🎙️')) etatMicro.textContent = '';
  });
  reco.addEventListener('error', () => {
    enEcoute = false;
    btnMicro.disabled = false;
    btnMicro.textContent = '🎤';
    etatMicro.textContent = 'Dictée indisponible (autorisez le micro dans le navigateur).';
  });
});
