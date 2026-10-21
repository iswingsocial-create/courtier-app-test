/**
 * scripts/test-exports-flotte.js — Exports flotte automobile (étape 5/10 flotte) :
 * 3 nouveaux modules (flotte_vehicules, flotte_conducteurs, flotte_soumissions
 * — l'historique figé est exporté DANS flotte_soumissions, versions imbriquées
 * en JSON, comme le module polices imbrique police_versions), CSV (BOM, « ; »,
 * en-têtes FR, libellés FR pour type/usage/statut), JSON structuré (décomptes
 * réels, somme des valeurs, NB sinistres/infractions calculés depuis le JSON,
 * garanties FAQ en 0/1), archivés, périmètre courtier, aucun secret, audit,
 * règle d'or (export = lecture seule, aucune mutation).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : CHEMIN_BD=<même que serveur> PORT=3101 node scripts/test-exports-flotte.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD, { readonly: true });

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;

function nouveauJar() { return {}; }
function appliquerCookies(jar, res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [paire] = c.split(';');
    const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
}
function enteteCookies(jar) {
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return paires.length ? { 'Cookie': paires.join('; ') } : {};
}
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = { ...enteteCookies(jar) };
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) { for (const x of v) params.append(k, x); }
      else params.append(k, v);
    }
    corps = params.toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const buf = Buffer.from(await res.arrayBuffer());
  const texte = buf.toString('utf8');
  return { statut: res.status, texte, buf, location: res.headers.get('location'), contentType: res.headers.get('content-type') || '' };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function connexion(jar, email, mdp) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return r;
}
async function changerMdp(jar, actuel, nouveau) {
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel, nouveau, confirmation: nouveau } });
  return r;
}

const MODULES_FLOTTE = ['flotte_vehicules', 'flotte_conducteurs', 'flotte_soumissions'];
const ENTETE_CLE = {
  flotte_vehicules: 'Conducteur principal', flotte_conducteurs: 'Classe de permis',
  flotte_soumissions: 'Somme des valeurs',
};

async function exporter(jar, module, format, archives = false) {
  let r = await req(jar, 'GET', '/exports');
  const form = { _csrf: csrf(r.texte), module, format };
  if (archives) form.archives = '1';
  return req(jar, 'POST', '/exports', { form });
}
function compteLignes() {
  return {
    s: bd.prepare('SELECT COUNT(*) AS n FROM flotte_soumissions').get().n,
    v: bd.prepare('SELECT COUNT(*) AS n FROM flotte_vehicules').get().n,
    c: bd.prepare('SELECT COUNT(*) AS n FROM flotte_conducteurs').get().n,
    ver: bd.prepare('SELECT COUNT(*) AS n FROM flotte_soumission_versions').get().n,
    archV: bd.prepare('SELECT COUNT(*) AS n FROM flotte_vehicules WHERE archive = 1').get().n,
  };
}

(async () => {
  console.log('== Exports flotte automobile (étape 5/10 flotte) ==');

  // 1. Login admin démo
  const jarA = nouveauJar();
  let r = await connexion(jarA, 'admin@demo.ca', 'ChangeMoi123!');
  test('login admin démo → 302', r.statut === 302, `${r.statut}`);
  r = await changerMdp(jarA, 'ChangeMoi123!', 'ExportFlotte2026!');
  test('changement mdp forcé → 302', r.statut === 302, `${r.statut}`);

  // 2. Page : 36 modules (33 + 3 cautionnement)
  r = await req(jarA, 'GET', '/exports');
  test('page exports → 200', r.statut === 200, `${r.statut}`);
  const tousPresents = MODULES_FLOTTE.every((m) => r.texte.includes(`value="${m}"`));
  test('3 modules flotte proposés', tousPresents);
  const nbOptions = (r.texte.match(/<option value="/g) || []).length;
  test('36 modules au total', nbOptions === 36, `${nbOptions}`);
  test('page : titres flotte visibles',
    r.texte.includes('Véhicules (flotte)') && r.texte.includes('Conducteurs (flotte)') && r.texte.includes('Soumissions flotte'));

  // 3. Créer des données flotte de démo via les routes
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Flotte Export inc.', prenom: 'Fl', nom: 'Ex', langue: 'FR' },
  });
  test('entreprise créée → 302', r.statut === 302, `${r.statut}`);
  const idClient = (r.location || '').match(/\/clients\/(\d+)/)[1];

  r = await req(jarA, 'GET', '/flotte/nouveau');
  r = await req(jarA, 'POST', '/flotte', {
    form: {
      _csrf: csrf(r.texte), client_id: idClient, nb_vehicules: '2', rayon_operation_km: '180',
      usage_dominant: 'transport_marchandises', date_effet_souhaitee: '2026-11-29',
      notes: 'Soumission flotte export test',
    },
  });
  test('soumission flotte créée → 302', r.statut === 302, `${r.statut}`);
  const idSoum = (r.location || '').match(/\/flotte\/(\d+)/)[1];

  // 3a. Conducteur avec 1 sinistre + 1 infraction
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  r = await req(jarA, 'POST', `/flotte/${idSoum}/conducteur`, {
    form: {
      _csrf: csrf(r.texte), nom: 'Exporteur', prenom: 'Émile', date_naissance: '1988-06-15',
      numero_permis: 'E123-150688-01', classe_permis: '3', annees_experience: '14',
      annees_experience_lourds: '8', date_embauche: '2019-04-01',
      sinistres_5ans: '2024-08-10 | Collision mineure en marche arrière | 2800 | totale',
      infractions_3ans: '2025-03-02 | Excès de vitesse | 15 km/h en zone 50 | 2',
      formations: 'Conduite préventive | 2025-05-20 | CFTR',
    },
  });
  test('conducteur ajouté → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  const idCond = (r.texte.match(/\/flotte\/conducteur\/(\d+)\/archiver/) || [])[1];
  test('id du conducteur trouvé sur la fiche', !!idCond);

  // 3b. Véhicules (2) : un lié au conducteur, un en nom libre
  r = await req(jarA, 'POST', `/flotte/${idSoum}/vehicule`, {
    form: {
      _csrf: csrf(r.texte), niv: '1HGBH41JXMN109999', annee: '2023', marque: 'Freightliner', modele: 'M2 106',
      type_vehicule: 'camion', usage: 'transport_marchandises', rayon_operation_km: '180',
      lieu_remisage: '900 rue Industrielle, Drummondville', valeur: '95000', annee_acquisition: '2023',
      conducteur_principal_id: idCond, equipements_speciaux: 'Grue auxiliaire | 8500',
    },
  });
  test('véhicule 1 (conducteur lié) ajouté → 302', r.statut === 302, `${r.statut}`);
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  r = await req(jarA, 'POST', `/flotte/${idSoum}/vehicule`, {
    form: {
      _csrf: csrf(r.texte), niv: '1T9UT2825NA777777', annee: '2021', marque: 'Manac', modele: 'Remorque 53 pi',
      type_vehicule: 'remorque', usage: 'transport_marchandises', rayon_operation_km: '180',
      lieu_remisage: '900 rue Industrielle, Drummondville', valeur: '32000', annee_acquisition: '2021',
      conducteur_principal_nom: 'Selon affectation',
    },
  });
  test('véhicule 2 (nom libre) ajouté → 302', r.statut === 302, `${r.statut}`);

  // 3c. Garanties : RC 2 M$, franchises, FAQ 43 + 27, prime
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  r = await req(jarA, 'POST', `/flotte/${idSoum}/garanties`, {
    form: {
      _csrf: csrf(r.texte), limite_rc: '2000000', franchise_collision: '1000',
      franchise_versement: '1000', avenants: ['faq43', 'faq27'], prime: '12400',
    },
  });
  test('garanties + FAQ 43/27 → 302', r.statut === 302, `${r.statut}`);

  // 3d. Antécédents : 1 sinistre flotte, ratio, consentements
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  r = await req(jarA, 'POST', `/flotte/${idSoum}/antecedents`, {
    form: {
      _csrf: csrf(r.texte), assureur_actuel: 'Assureur Flotte actuel inc.',
      numero_police_actuelle: 'FLT-EXP-1', date_expiration_actuelle: '2026-11-29',
      annees_assurance_flotte_continue: '5',
      sinistres_flotte_5ans: '2024-08-10 | Collision mineure (camion) | 2800',
      ratio_pertes: '22.5', consentement_credit: 'on', consentement_dossier_saaq: 'on',
    },
  });
  test('antécédents + sinistre flotte → 302', r.statut === 302, `${r.statut}`);

  // Règle d'or : état avant exports
  const avant = compteLignes();

  // 4. Chaque module flotte en CSV
  for (const m of MODULES_FLOTTE) {
    r = await exporter(jarA, m, 'csv');
    const ct = r.contentType.includes('text/csv');
    const bom = r.buf.length >= 3 && r.buf[0] === 0xEF && r.buf[1] === 0xBB && r.buf[2] === 0xBF;
    const premiere = r.texte.replace(/^﻿/, '').split('\r\n')[0] || '';
    const enteteOk = premiere.includes(';') && premiere.includes(ENTETE_CLE[m]);
    test(`CSV ${m} → 200, BOM, « ; », en-tête FR`, r.statut === 200 && ct && bom && enteteOk,
      `${r.statut} entete=${premiere.slice(0, 60)}`);
  }

  // 5. Chaque module flotte en JSON
  const tousJson = [];
  for (const m of MODULES_FLOTTE) {
    r = await exporter(jarA, m, 'json');
    let j = null;
    try { j = JSON.parse(r.texte); } catch (e) { /* */ }
    const ok = r.statut === 200 && r.contentType.includes('application/json') && j
      && j.module === m && Array.isArray(j.donnees) && j.perimetre === 'cabinet' && typeof j.nombre === 'number';
    test(`JSON ${m} → 200, structure valide`, !!ok, `${r.statut}`);
    if (j) tousJson.push(r.texte);
  }

  // 6. Seed Lapointe : 4 véhicules, 3 conducteurs, somme des valeurs 155 500
  r = await exporter(jarA, 'flotte_vehicules', 'json');
  const jVeh = JSON.parse(r.texte);
  const vehLapointe = jVeh.donnees.filter((x) => x.entreprise === 'Transport Lapointe inc.');
  test('seed Lapointe : 4 véhicules exportés', vehLapointe.length === 4, `${vehLapointe.length}`);
  const somme = vehLapointe.reduce((s, x) => s + (Number(x.valeur) || 0), 0);
  test('seed Lapointe : somme des valeurs des véhicules = 155 500', somme === 155500, `${somme}`);
  const transit = vehLapointe.find((x) => x.modele === 'Transit 250');
  test('seed Lapointe : conducteur principal lié résolu (Jean-François Lapointe)',
    !!transit && transit.conducteur_principal === 'Jean-François Lapointe',
    JSON.stringify(transit && transit.conducteur_principal));
  test('seed Lapointe : équipements spéciaux parsés (hayon)',
    !!transit && Array.isArray(transit.equipements_speciaux)
    && transit.equipements_speciaux.length === 1
    && transit.equipements_speciaux[0].description.includes('Hayon'));
  const remorque = vehLapointe.find((x) => x.type_vehicule === 'remorque');
  test('seed Lapointe : conducteur principal en nom libre (remorque)',
    !!remorque && remorque.conducteur_principal === 'Selon affectation',
    JSON.stringify(remorque && remorque.conducteur_principal));

  r = await exporter(jarA, 'flotte_vehicules', 'csv');
  const entV = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV véhicules : en-têtes FR',
    entV.includes('NIV') && entV.includes('Type de véhicule') && entV.includes('Conducteur principal')
    && entV.includes('Équipements spéciaux (JSON)'), entV.slice(0, 160));
  test('CSV véhicules : type et usage en libellés FR (jamais les codes)',
    r.texte.includes('Camion') && r.texte.includes('Transport de marchandises')
    && !r.texte.includes(';camion;') && !r.texte.includes(';transport_marchandises;'));

  // 7. Conducteurs : décomptes calculés depuis le JSON
  r = await exporter(jarA, 'flotte_conducteurs', 'json');
  const jCond = JSON.parse(r.texte);
  const condLapointe = jCond.donnees.filter((x) => x.entreprise === 'Transport Lapointe inc.');
  test('seed Lapointe : 3 conducteurs exportés', condLapointe.length === 3, `${condLapointe.length}`);
  const gagnon = condLapointe.find((x) => x.nom === 'Gagnon');
  test('conducteur seed : sinistres/infractions parsés (Gagnon 1/1)',
    !!gagnon && Array.isArray(gagnon.sinistres_5ans) && gagnon.sinistres_5ans.length === 1
    && Array.isArray(gagnon.infractions_3ans) && gagnon.infractions_3ans.length === 1
    && gagnon.classe_permis === '3',
    JSON.stringify(gagnon && { s: gagnon.sinistres_5ans && gagnon.sinistres_5ans.length, i: gagnon.infractions_3ans && gagnon.infractions_3ans.length }));
  r = await exporter(jarA, 'flotte_conducteurs', 'csv');
  const entC = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV conducteurs : colonnes décomptes calculés',
    entC.includes('Nb sinistres 5 ans') && entC.includes('Nb infractions 3 ans')
    && entC.includes('Classe de permis') && entC.includes('Années d’expérience'),
    entC.slice(0, 160));
  const ligneGagnon = r.texte.split('\r\n').find((l) => l.includes('Gagnon'));
  test('CSV conducteurs : Gagnon nb sinistres = 1, nb infractions = 1',
    !!ligneGagnon && /;1;/.test(ligneGagnon), (ligneGagnon || '').slice(0, 200));
  const emile = jCond.donnees.find((x) => x.nom === 'Exporteur' && x.soumission_id === Number(idSoum));
  test('conducteur créé : sinistre + infraction + formation parsés',
    !!emile && emile.sinistres_5ans.length === 1 && emile.infractions_3ans.length === 1
    && emile.formations.length === 1 && emile.sinistres_5ans[0].montant === 2800,
    JSON.stringify(emile && { s: emile.sinistres_5ans, i: emile.infractions_3ans }));

  // 8. Soumissions : en-tête, décomptes réels, garanties, antécédents, versions
  r = await exporter(jarA, 'flotte_soumissions', 'json');
  const jSou = JSON.parse(r.texte);
  const sExp = jSou.donnees.find((s) => s.id === Number(idSoum));
  test('soumission créée : décomptes réels (2 véhicules, 1 conducteur)',
    !!sExp && sExp.nb_vehicules_reel === 2 && sExp.nb_conducteurs === 1 && sExp.nb_vehicules === 2,
    JSON.stringify(sExp && { r: sExp.nb_vehicules_reel, c: sExp.nb_conducteurs, d: sExp.nb_vehicules }));
  test('soumission créée : somme des valeurs = 127 000',
    !!sExp && Number(sExp.somme_valeurs) === 127000, JSON.stringify(sExp && sExp.somme_valeurs));
  test('soumission créée : garanties imbriquées (RC 2 M$, prime)',
    !!sExp && sExp.garanties && sExp.garanties.limite_rc === 2000000
    && sExp.garanties.franchise_collision === 1000 && sExp.garanties.prime === 12400,
    JSON.stringify(sExp && sExp.garanties));
  test('soumission créée : avenants FAQ (43 et 27 présents, 20 absent)',
    !!sExp && sExp.garanties.avenants.faq43 == 1 && sExp.garanties.avenants.faq27 == 1
    && !sExp.garanties.avenants.faq20,
    JSON.stringify(sExp && sExp.garanties.avenants));
  test('soumission créée : antécédents (5 ans continus, 1 sinistre, ratio 22,5)',
    !!sExp && sExp.annees_assurance_flotte_continue === 5
    && Array.isArray(sExp.sinistres_flotte_5ans) && sExp.sinistres_flotte_5ans.length === 1
    && Number(sExp.ratio_pertes) === 22.5,
    JSON.stringify(sExp && { a: sExp.annees_assurance_flotte_continue, r: sExp.ratio_pertes }));
  test('soumission créée : consentements (crédit + SAAQ)',
    !!sExp && sExp.consentements.credit == 1 && sExp.consentements.dossier_saaq == 1,
    JSON.stringify(sExp && sExp.consentements));
  test('versions exportées : historique figé imbriqué (≥5, snapshot complet)',
    !!sExp && Array.isArray(sExp.versions) && sExp.versions.length >= 5
    && sExp.version_courante >= 5 && sExp.nb_versions === sExp.versions.length
    && !!sExp.versions[sExp.versions.length - 1].donnees
    && Array.isArray(sExp.versions[sExp.versions.length - 1].donnees.vehicules)
    && Array.isArray(sExp.versions[sExp.versions.length - 1].donnees.conducteurs)
    && !!sExp.versions[sExp.versions.length - 1].donnees.garanties,
    JSON.stringify(sExp && { v: sExp.version_courante, nv: sExp.nb_versions }));
  const sLap = jSou.donnees.find((s) => s.entreprise === 'Transport Lapointe inc.');
  test('seed Lapointe : soumission (4 véhicules réels, somme 155 500, RC 2 M$, prime 9 850)',
    !!sLap && sLap.nb_vehicules_reel === 4 && Number(sLap.somme_valeurs) === 155500
    && sLap.garanties.limite_rc === 2000000 && Number(sLap.garanties.prime) === 9850,
    JSON.stringify(sLap && { n: sLap.nb_vehicules_reel, somme: sLap.somme_valeurs }));
  test('seed Lapointe : avenants FAQ du seed (43, 20, 27, 34 ; pas 5a) + 1 sinistre flotte',
    !!sLap && sLap.garanties.avenants.faq43 == 1 && sLap.garanties.avenants.faq20 == 1
    && sLap.garanties.avenants.faq27 == 1 && sLap.garanties.avenants.faq34 == 1
    && !sLap.garanties.avenants.faq5a
    && sLap.sinistres_flotte_5ans.length === 1 && sLap.annees_assurance_flotte_continue === 6,
    JSON.stringify(sLap && sLap.garanties.avenants));

  r = await exporter(jarA, 'flotte_soumissions', 'csv');
  const entS = (r.texte.replace(/^﻿/, '').split('\r\n')[0] || '');
  test('CSV soumissions : en-têtes FR (usage, somme, avenants)',
    entS.includes('Usage dominant') && entS.includes('Somme des valeurs')
    && entS.includes('Limite RC') && entS.includes('Nb sinistres flotte 5 ans')
    && entS.includes('Avenant FAQ 43 (valeur à neuf)') && entS.includes('Avenant FAQ 27 (véhicule non appartenant)'),
    entS.slice(0, 220));
  test('CSV soumissions : usage dominant en libellé FR (jamais le code)',
    r.texte.includes('Transport de marchandises') && !entS.includes('transport_marchandises'));
  test('CSV soumissions : statut en libellé FR', r.texte.includes('Brouillon'));

  // 9. Aucun secret
  const concat = tousJson.join('\n');
  test('aucun hash ni secret exporté',
    !concat.includes('mot_de_passe_hash') && !concat.includes('totp_secret') && !concat.includes('_chiffre'));

  // 10. Règle d'or : les exports n'ont rien muté
  const apres = compteLignes();
  test('règle d’or : exports en lecture seule (aucune ligne créée/supprimée/archivée)',
    avant.s === apres.s && avant.v === apres.v && avant.c === apres.c
    && avant.ver === apres.ver && avant.archV === apres.archV,
    JSON.stringify({ avant, apres }));

  // 11. Archivés : exclure / inclure
  r = await req(jarA, 'GET', '/flotte/' + idSoum);
  const idVeh = (r.texte.match(/\/flotte\/vehicule\/(\d+)\/archiver/) || [])[1];
  test('id de véhicule trouvé sur la fiche', !!idVeh);
  r = await req(jarA, 'POST', `/flotte/vehicule/${idVeh}/archiver`, { form: { _csrf: csrf(r.texte) } });
  test('archivage véhicule → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarA, 'flotte_vehicules', 'json', false);
  test('véhicule archivé exclu par défaut', !JSON.parse(r.texte).donnees.some((x) => String(x.id) === String(idVeh)));
  r = await exporter(jarA, 'flotte_vehicules', 'json', true);
  const vArc = JSON.parse(r.texte).donnees.find((x) => String(x.id) === String(idVeh));
  test('véhicule archivé inclus avec la case', !!vArc && vArc.archive == 1);

  // 12. Périmètre courtier
  const creerU = async (nom, email, role, mdp) => {
    let rr = await req(jarA, 'GET', '/admin/utilisateurs/nouveau');
    rr = await req(jarA, 'POST', '/admin/utilisateurs', {
      form: { _csrf: csrf(rr.texte), nom, email, cabinet_id: '1', role, mot_de_passe: mdp },
    });
    if (rr.statut !== 302) return null;
    rr = await req(jarA, 'GET', '/admin/utilisateurs');
    const m = rr.texte.match(new RegExp(email.replace(/\./g, '\\.') + '[\\s\\S]*?\\/admin\\/utilisateurs\\/(\\d+)\\/desactiver'));
    return m ? m[1] : null;
  };
  const idCourtier = await creerU('Courtier Flotte', 'courtierflotte@test.ca', 'courtier', 'CourtierFlotte1!');
  test('création courtier → ok', !!idCourtier);
  r = await req(jarA, 'GET', '/clients/nouveau');
  r = await req(jarA, 'POST', '/clients', {
    form: { _csrf: csrf(r.texte), raison_sociale: 'Portefeuille Flotte inc.', prenom: 'Po', nom: 'Fl', langue: 'FR', responsable_id: idCourtier },
  });
  test('entreprise du courtier → 302', r.statut === 302, `${r.statut}`);
  const idClientC = (r.location || '').match(/\/clients\/(\d+)/)[1];
  const jarC = nouveauJar();
  await connexion(jarC, 'courtierflotte@test.ca', 'CourtierFlotte1!');
  await changerMdp(jarC, 'CourtierFlotte1!', 'CourtierFlotte2!');
  r = await req(jarC, 'GET', '/flotte/nouveau');
  r = await req(jarC, 'POST', '/flotte', {
    form: { _csrf: csrf(r.texte), client_id: idClientC, notes: 'Soumission flotte du courtier' },
  });
  test('courtier crée sa soumission flotte → 302', r.statut === 302, `${r.statut}`);
  r = await exporter(jarC, 'flotte_soumissions', 'json');
  const jCS = JSON.parse(r.texte);
  test('courtier : périmètre portefeuille', jCS.perimetre === 'portefeuille', jCS.perimetre);
  test('courtier : seulement sa soumission',
    jCS.nombre === 1 && jCS.donnees[0].entreprise === 'Portefeuille Flotte inc.', `${jCS.nombre}`);
  r = await exporter(jarC, 'flotte_vehicules', 'json');
  test('courtier : aucun véhicule hors portefeuille', JSON.parse(r.texte).nombre === 0);
  r = await exporter(jarC, 'flotte_conducteurs', 'json');
  test('courtier : aucun conducteur hors portefeuille', JSON.parse(r.texte).nombre === 0);

  // 13. Journal d'audit
  r = await req(jarA, 'GET', '/admin/journal');
  const nbExports = (r.texte.match(/Export flotte_/g) || []).length;
  test('journal contient les exports flotte', r.statut === 200 && nbExports >= 3, `${r.statut} (${nbExports})`);

  // 14. Module/format invalides + CSRF
  r = await exporter(jarA, 'flotte_nope', 'csv');
  test('module inconnu → 400', r.statut === 400, `${r.statut}`);
  r = await req(jarA, 'POST', '/exports', { form: { module: 'flotte_vehicules', format: 'csv' } });
  test('POST sans CSRF → 403', r.statut === 403, `${r.statut}`);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  console.log(echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `💥 ${echecs} ÉCHEC(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})().catch((e) => { console.error('💥 ERREUR FATALE :', e.message); process.exit(1); });
