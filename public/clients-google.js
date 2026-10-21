/**
 * public/clients-google.js — Formulaire d'entreprise : bouton « 🔍 Rechercher
 * sur Google Maps » → candidats (via /google-places/rechercher, la clé reste
 * côté serveur) → un clic remplit le formulaire (raison sociale, adresse,
 * ville, province, code postal, téléphone de l'entreprise, site web) et pose
 * l'identifiant Google (champ caché place_id_google), enregistré à la
 * création. Rien n'est enregistré sans le clic « Enregistrer » du formulaire.
 * Compatible CSP (aucun gestionnaire inline).
 */
document.addEventListener('DOMContentLoaded', () => {
  const bouton = document.getElementById('btn-rech-google');
  if (!bouton) return; // clé non configurée : le bloc n'est pas rendu
  const saisie = document.getElementById('rech-google-q');
  const zone = document.getElementById('resultats-google');
  const poser = (id, valeur) => {
    const el = document.getElementById(id);
    if (el && valeur) el.value = valeur;
  };

  bouton.addEventListener('click', async () => {
    const q = (saisie.value || '').trim();
    zone.textContent = '';
    if (q.length < 2) {
      zone.textContent = 'Tapez au moins 2 caractères (nom de l’entreprise, ville…).';
      return;
    }
    bouton.disabled = true;
    try {
      const res = await fetch('/google-places/rechercher?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (data.statut === 'non_configure') {
        zone.textContent = 'Clé Google Maps non configurée — demandez à un administrateur (Admin → Clé IA, section Google Maps).';
        return;
      }
      if (!data.ok) {
        zone.textContent = '⚠️ ' + (data.message || 'Recherche impossible pour le moment.');
        return;
      }
      if (!data.resultats.length) {
        zone.textContent = 'Aucune entreprise trouvée sur Google Maps pour cette recherche.';
        return;
      }
      for (const cand of data.resultats) {
        const bloc = document.createElement('div');
        bloc.style.cssText = 'border:1px solid #ddd;border-radius:6px;padding:8px;margin:6px 0;';
        const titre = document.createElement('strong');
        titre.textContent = cand.raison_sociale || 'Sans nom';
        bloc.appendChild(titre);
        if (cand.note != null) {
          bloc.appendChild(document.createTextNode(` · ★ ${cand.note} (${cand.nb_avis || 0} avis)`));
        }
        bloc.appendChild(document.createElement('br'));
        const details = document.createElement('span');
        details.className = 'petit';
        details.textContent = [cand.adresse_complete, cand.telephone, cand.site_web].filter(Boolean).join(' · ');
        bloc.appendChild(details);
        bloc.appendChild(document.createElement('br'));
        const choix = document.createElement('button');
        choix.type = 'button';
        choix.className = 'btn btn-petit';
        choix.textContent = 'Utiliser ces coordonnées';
        choix.addEventListener('click', () => {
          poser('raison_sociale', cand.raison_sociale);
          poser('adresse', cand.adresse);
          poser('ville', cand.ville);
          poser('province', cand.province);
          poser('code_postal', cand.code_postal);
          poser('telephone_entreprise', cand.telephone);
          poser('site_web', cand.site_web);
          poser('place_id_google', cand.place_id);
          zone.textContent = '✅ Coordonnées remplies — vérifiez puis cliquez « Enregistrer ».';
        });
        bloc.appendChild(choix);
        zone.appendChild(bloc);
      }
    } catch (e) {
      zone.textContent = '⚠️ Recherche impossible (connexion). Réessayez.';
    } finally {
      bouton.disabled = false;
    }
  });
});
