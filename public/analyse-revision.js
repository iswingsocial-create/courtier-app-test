/**
 * public/analyse-revision.js — Écran de révision des analyses de documents :
 * bouton « + Ajouter une ligne » des tableaux de listes (véhicules,
 * conducteurs...). Clone le <template> de la liste, numérote la nouvelle
 * ligne à la suite des existantes (le serveur balaie les clés du formulaire)
 * et l'insère cochée, prête à corriger puis à insérer.
 */
/**
 * Filtrage des rattachements par client (et par produit) — correctif de la
 * révision d'analyse : on choisit d'abord le « Client du document », puis
 * les sélecteurs « soumission existante » et « police existante » ne
 * proposent que les éléments DE ce client (soumissions : du produit choisi
 * en plus). Sans client choisi, les rattachements sont désactivés. Le
 * serveur revérifie tout à l'insertion — ce filtrage est un confort,
 * pas le garde-fou.
 */
(function () {
  var selClient = document.getElementById('client_id');
  var selProduit = document.getElementById('produit');
  var selSoum = document.getElementById('select-soumission-existante');
  var selPol = document.getElementById('select-police-existante');
  if (!selClient || !selSoum || !selPol) return;
  var msgSoum = document.getElementById('msg-aucune-soumission');
  var msgPol = document.getElementById('msg-aucune-police');

  function filtrer(sel, ok, msg) {
    var visibles = 0;
    var selectionVisible = false;
    Array.prototype.forEach.call(sel.options, function (opt) {
      var v = !!ok(opt);
      opt.hidden = !v;
      opt.disabled = !v;
      if (v) { visibles++; if (opt.selected) selectionVisible = true; }
    });
    if (!selectionVisible) {
      var premiere = Array.prototype.find.call(sel.options, function (o) { return !o.disabled; });
      sel.value = premiere ? premiere.value : '';
    }
    if (msg) msg.style.display = visibles ? 'none' : '';
    return visibles;
  }

  function maj() {
    var client = selClient.value || '';
    var produit = selProduit ? (selProduit.value || '') : '';
    filtrer(selSoum, function (opt) {
      return !!client
        && opt.getAttribute('data-client') === client
        && (!produit || opt.getAttribute('data-produit') === produit);
    }, msgSoum);
    filtrer(selPol, function (opt) {
      return !!client && opt.getAttribute('data-client') === client;
    }, msgPol);
    ['soumission_existante', 'police_existante'].forEach(function (val) {
      var radio = document.querySelector('input[name="cible"][value="' + val + '"]');
      if (radio) radio.disabled = !client;
    });
    selSoum.disabled = !client;
    selPol.disabled = !client;
  }

  selClient.addEventListener('change', maj);
  if (selProduit) selProduit.addEventListener('change', maj);
  maj();
})();

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
