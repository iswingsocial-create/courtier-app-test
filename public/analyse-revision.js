/**
 * public/analyse-revision.js — Écran de révision des analyses de documents :
 * bouton « + Ajouter une ligne » des tableaux de listes (véhicules,
 * conducteurs...). Clone le <template> de la liste, numérote la nouvelle
 * ligne à la suite des existantes (le serveur balaie les clés du formulaire)
 * et l'insère cochée, prête à corriger puis à insérer.
 */
(function () {
  document.querySelectorAll('[data-ajouter-ligne]').forEach(function (bouton) {
    bouton.addEventListener('click', function () {
      var type = bouton.getAttribute('data-ajouter-ligne');
      var corps = document.getElementById('corps-liste-' + type);
      var modele = document.getElementById('modele-ligne-' + type);
      if (!corps || !modele) return;
      var prochain = parseInt(corps.getAttribute('data-prochain-index') || '0', 10);
      var fragment = modele.content.cloneNode(true);
      fragment.querySelectorAll('[name]').forEach(function (champ) {
        champ.setAttribute('name', champ.getAttribute('name').replace(/__N__/g, String(prochain)));
      });
      corps.appendChild(fragment);
      corps.setAttribute('data-prochain-index', String(prochain + 1));
    });
  });
})();
