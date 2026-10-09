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
      attente.textContent = data.reponse || data.erreur || 'Erreur inattendue.';
    } catch (err) {
      attente.textContent = 'Erreur de connexion. Réessayez.';
    }
    defiler();
  });

  // --- Dictée vocale -----------------------------------------------------------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    btnMicro.style.display = 'none';
    return;
  }
  const reco = new Recognition();
  reco.lang = 'fr-FR';
  reco.interimResults = false;
  reco.maxAlternatives = 1;

  btnMicro.addEventListener('click', () => {
    try {
      reco.start();
      etatMicro.textContent = '🎙️ Parlez…';
      btnMicro.disabled = true;
    } catch (e) { /* déjà en écoute */ }
  });
  reco.addEventListener('result', (e) => {
    const texte = e.results[0][0].transcript;
    input.value = (input.value ? input.value + ' ' : '') + texte;
    etatMicro.textContent = '';
  });
  reco.addEventListener('end', () => { btnMicro.disabled = false; etatMicro.textContent = ''; });
  reco.addEventListener('error', () => {
    btnMicro.disabled = false;
    etatMicro.textContent = 'Dictée indisponible (autorisez le micro dans le navigateur).';
  });
});
