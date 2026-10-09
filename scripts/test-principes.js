/**
 * scripts/test-principes.js — Tests de la règle d'or « RIEN ne se supprime » :
 * archivage/désarchivage partout (entreprises, tâches, leads, campagnes, réunions,
 * brouillons, réclamations, documents), désactivation d'utilisateur (login refusé),
 * versioning des polices (v1, v2… snapshots intacts), statuts de réclamation
 * ouverte/fermee, anciennes routes de suppression → 404, cloisonnement, journal d'audit.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 node scripts/test-principes.js
 */
const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;

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
    corps = new URLSearchParams(form).toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
}

function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

function test(nom, condition, detail) {
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}

const fmt = (d) => d.toISOString().slice(0, 10);
function dansJours(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

// Cycle standard : archiver → invisible → visible via ?archives=1 → désarchiver → visible
async function testerCycleArchivage(jar, nom, { liste, fiche, marque, archiver, desarchiver, journalAction }) {
  const jetonFiche = async () => csrf((await req(jar, 'GET', fiche)).texte);
  let r = await req(jar, 'GET', liste);
  test(`${nom} : visible en liste avant`, r.statut === 200 && marque.test(r.texte), r.statut);

  r = await req(jar, 'POST', archiver, { form: { _csrf: await jetonFiche() } });
  test(`${nom} : POST archiver → 302`, r.statut === 302, r.statut);

  // CSRF obligatoire : sans jeton → 403 (sécurité conservée)
  r = await req(jar, 'POST', desarchiver, { form: {} });
  test(`${nom} : désarchiver sans CSRF → 403`, r.statut === 403, r.statut);

  r = await req(jar, 'GET', liste);
  test(`${nom} : invisible en liste après archivage`, r.statut === 200 && !marque.test(r.texte));

  r = await req(jar, 'GET', liste + '?archives=1');
  test(`${nom} : visible via « Voir les archivés »`, r.statut === 200 && marque.test(r.texte), r.statut);

  r = await req(jar, 'GET', '/admin/journal');
  test(`${nom} : archivage journalisé`, r.statut === 200 && new RegExp(journalAction).test(r.texte), journalAction);

  r = await req(jar, 'POST', desarchiver, { form: { _csrf: await jetonFiche() } });
  test(`${nom} : POST désarchiver → 302`, r.statut === 302, r.statut);

  r = await req(jar, 'GET', liste);
  test(`${nom} : visible en liste après désarchivage`, r.statut === 200 && marque.test(r.texte));
}

(async () => {
  console.log('== Tests règle d\'or (archivage/versioning) :', BASE);
  const jar = nouveauJar();

  // ---- 1. Login ------------------------------------------------------------------
  console.log('1. Login');
  let r = await req(jar, 'GET', '/connexion');
  let jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: jeton, email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login démo → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Entreprise + police (base du versioning) --------------------------------
  console.log('2. Entreprise et police');
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: 'Archive Test inc.', neq: '9988776655', secteur_activite: 'Test',
    prenom: 'Bob', nom: 'Archive', titre_contact: 'DG', courriel: 'bob@archivetest.ca',
    telephone: '514-555-0909', adresse: '9 rue Archive', ville: 'Laval', code_postal: 'H7N 9Z9',
    langue: 'FR', notes: '', responsable_id: '1', consent_communications: 'on',
  }});
  test('création entreprise → 302', r.statut === 302, r.statut);
  const idEnt = (r.location || '').match(/\/clients\/(\d+)/)[1];

  r = await req(jar, 'GET', '/polices/nouvelle?client=' + idEnt);
  r = await req(jar, 'POST', '/polices', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, ligne: 'cgl', assureur: 'Assureur Test',
    numero_police: 'POL-ARCH-1', date_effet: dansJours(-300), date_echeance: dansJours(60),
    franchise: '5000', statut: 'active', notes: 'Police de test', responsable_id: '1',
  }});
  test('création police → 302', r.statut === 302 && /\/echeances\/police\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idPolice = (r.location || '').match(/\/police\/(\d+)/)[1];

  // ---- 3. Archivage : entreprises --------------------------------------------------
  console.log('3. Archivage entreprises');
  await testerCycleArchivage(jar, 'entreprise', {
    liste: '/clients', fiche: '/clients/' + idEnt, marque: /Archive Test inc\./,
    archiver: `/clients/${idEnt}/archiver`, desarchiver: `/clients/${idEnt}/desarchiver`,
    journalAction: 'entreprise_archivee',
  });

  // ---- 4. Versioning des polices ----------------------------------------------------
  console.log('4. Versioning des polices');
  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  test('fiche révision → 200 + historique des versions', r.statut === 200 && /Historique des versions/.test(r.texte) && /v1/.test(r.texte), r.statut);
  test('bouton « Nouvelle version (avenant) »', /Nouvelle version \(avenant\)/.test(r.texte));

  r = await req(jar, 'GET', `/polices/${idPolice}/versions`);
  test('historique détaillé → 200', r.statut === 200 && /v1/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions/1`);
  test('snapshot v1 → 200 + franchise 5000 $', r.statut === 200 && /5000\.00/.test(r.texte) && /lecture seule/.test(r.texte), r.statut);

  // Modification → v2
  r = await req(jar, 'GET', `/polices/${idPolice}/modifier`);
  r = await req(jar, 'POST', `/polices/${idPolice}`, { form: {
    _csrf: csrf(r.texte), client_id: idEnt, ligne: 'cgl', assureur: 'Assureur Test',
    numero_police: 'POL-ARCH-1', date_effet: dansJours(-300), date_echeance: dansJours(60),
    franchise: '7500', statut: 'active', notes: 'Police de test — avenant', responsable_id: '1',
  }});
  test('modification → 302 (crée v2)', r.statut === 302, r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions`);
  test('v2 présente', r.statut === 200 && /v2/.test(r.texte) && /v1/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions/1`);
  test('snapshot v1 intact (franchise 5000 $)', r.statut === 200 && /5000\.00/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions/2`);
  test('snapshot v2 (franchise 7500 $)', r.statut === 200 && /7500\.00/.test(r.texte), r.statut);

  // Ajout de protection → v3, retrait → v4
  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  r = await req(jar, 'POST', `/polices/${idPolice}/protections`, { form: { _csrf: csrf(r.texte), code: 'CGL-RESP', prime: '1200.00' } });
  test('ajout protection → 302 (crée v3)', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/echeances/police/' + idPolice);
  const mProt = r.texte.match(new RegExp(`/polices/${idPolice}/protections/(\\d+)/retirer`));
  test('protection visible sur la fiche', !!mProt && /CGL-RESP/.test(r.texte));
  r = await req(jar, 'POST', `/polices/${idPolice}/protections/${mProt[1]}/retirer`, { form: { _csrf: csrf(r.texte) } });
  test('retrait protection → 302 (crée v4)', r.statut === 302, r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions/3`);
  test('snapshot v3 contient la protection retirée', r.statut === 200 && /CGL-RESP/.test(r.texte), r.statut);
  r = await req(jar, 'GET', `/polices/${idPolice}/versions/4`);
  test('snapshot v4 sans la protection', r.statut === 200 && !/CGL-RESP/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/admin/journal');
  test('versions journalisées (police_version)', /police_version/.test(r.texte));

  // ---- 5. Archivage : réclamations (statuts Ouverte/Fermée) -------------------------
  console.log('5. Réclamations : statuts + archivage');
  r = await req(jar, 'GET', '/reclamations/nouvelle');
  r = await req(jar, 'POST', '/reclamations', { form: {
    _csrf: csrf(r.texte), client_id: idEnt, police_id: idPolice, numero_reclamation: 'SIN-ARCH-1',
    date_sinistre: dansJours(-5), date_declaration: dansJours(-4),
    description: 'Dégât des eaux, test archivage.', statut: 'ouverte',
    montant_reclame: '8000', franchise_appliquee: '5000', responsable_id: '1', notes: '',
  }});
  test('création réclamation (ouverte) → 302', r.statut === 302, r.statut);
  const idRec = (r.location || '').match(/\/reclamations\/(\d+)/)[1];

  r = await req(jar, 'GET', '/reclamations');
  test('liste affiche « Ouverte »', r.statut === 200 && /Ouverte/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/reclamations/' + idRec);
  test('fiche réclamation → libellé « Ouverte »', r.statut === 200 && /Ouverte/.test(r.texte), r.statut);
  r = await req(jar, 'POST', `/reclamations/${idRec}/statut`, { form: { _csrf: csrf(r.texte), statut: 'fermee' } });
  test('passage à Fermée → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/reclamations/' + idRec);
  test('libellé « Fermée » affiché', /Fermée/.test(r.texte));
  r = await req(jar, 'POST', `/reclamations/${idRec}/statut`, { form: { _csrf: csrf(r.texte), statut: 'declaree' } });
  test('ancien statut « declaree » → 400', r.statut === 400, r.statut);

  await testerCycleArchivage(jar, 'réclamation', {
    liste: '/reclamations', fiche: '/reclamations/' + idRec, marque: /SIN-ARCH-1/,
    archiver: `/reclamations/${idRec}/archiver`, desarchiver: `/reclamations/${idRec}/desarchiver`,
    journalAction: 'reclamation_archivee',
  });

  // ---- 6. Archivage : tâches ----------------------------------------------------------
  console.log('6. Archivage tâches');
  r = await req(jar, 'GET', '/taches/nouvelle');
  r = await req(jar, 'POST', '/taches', { form: {
    _csrf: csrf(r.texte), titre: 'Tâche Archivage Test', date_echeance: dansJours(5),
    statut: 'a_faire', assigne_a: '1', entreprise_id: idEnt, notes: '',
  }});
  test('création tâche → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/taches');
  const mTache = r.texte.match(/Tâche Archivage Test[\s\S]*?\/taches\/(\d+)\/modifier/);
  test('tâche visible', !!mTache);
  const idTache = mTache[1];
  await testerCycleArchivage(jar, 'tâche', {
    liste: '/taches', fiche: '/taches/' + idTache + '/modifier', marque: /Tâche Archivage Test/,
    archiver: `/taches/${idTache}/archiver`, desarchiver: `/taches/${idTache}/desarchiver`,
    journalAction: 'tache_archivee',
  });

  // ---- 7. Archivage : leads ------------------------------------------------------------
  console.log('7. Archivage leads');
  r = await req(jar, 'GET', '/leads/nouveau');
  r = await req(jar, 'POST', '/leads', { form: {
    _csrf: csrf(r.texte), nom: 'Lead Archivage', entreprise: 'Lead SARL', courriel: 'lead@arch.ca',
    telephone: '514-555-0111', besoin: 'Test archivage', source: 'autre', statut: 'nouveau',
  }});
  test('création lead → 302', r.statut === 302 && /\/leads\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idLead = (r.location || '').match(/\/leads\/(\d+)/)[1];
  await testerCycleArchivage(jar, 'lead', {
    liste: '/leads', fiche: '/leads/' + idLead, marque: /Lead Archivage/,
    archiver: `/leads/${idLead}/archiver`, desarchiver: `/leads/${idLead}/desarchiver`,
    journalAction: 'lead_archive',
  });

  // ---- 8. Archivage : campagnes ----------------------------------------------------------
  console.log('8. Archivage campagnes');
  r = await req(jar, 'GET', '/campagnes/nouvelle');
  r = await req(jar, 'POST', '/campagnes', { form: {
    _csrf: csrf(r.texte), nom: 'Campagne Archivage', secteurs: 'Test',
    objet: 'Objet de test', contenu: 'Contenu de test pour archivage. '.repeat(5),
  }});
  test('création campagne → 302', r.statut === 302 && /\/campagnes\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idCamp = (r.location || '').match(/\/campagnes\/(\d+)/)[1];
  await testerCycleArchivage(jar, 'campagne', {
    liste: '/campagnes', fiche: '/campagnes/' + idCamp, marque: /Campagne Archivage/,
    archiver: `/campagnes/${idCamp}/archiver`, desarchiver: `/campagnes/${idCamp}/desarchiver`,
    journalAction: 'campagne_archivee',
  });

  // ---- 9. Archivage : réunions ------------------------------------------------------------
  console.log('9. Archivage réunions');
  const dh = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  r = await req(jar, 'GET', '/reunions/nouvelle');
  r = await req(jar, 'POST', '/reunions', { form: {
    _csrf: csrf(r.texte), titre: 'Réunion Archivage Test', date_heure: dh,
    client_id: idEnt, lead_id: '', lien_teams: '', notes: '',
  }});
  test('création réunion → 302', r.statut === 302 && /\/reunions\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idReu = (r.location || '').match(/\/reunions\/(\d+)/)[1];
  await testerCycleArchivage(jar, 'réunion', {
    liste: '/reunions', fiche: '/reunions/' + idReu, marque: /Réunion Archivage Test/,
    archiver: `/reunions/${idReu}/archiver`, desarchiver: `/reunions/${idReu}/desarchiver`,
    journalAction: 'reunion_archivee',
  });

  // ---- 10. Archivage : brouillons ----------------------------------------------------------
  console.log('10. Archivage brouillons');
  r = await req(jar, 'POST', `/brouillons/generer/${idPolice}`, { form: { _csrf: csrf((await req(jar, 'GET', '/echeances/police/' + idPolice)).texte) || '' } });
  test('génération brouillon → 302', r.statut === 302 && /\/brouillons\/\d+/.test(r.location || ''), `${r.statut} ${r.location}`);
  const idBrouillon = (r.location || '').match(/\/brouillons\/(\d+)/)[1];
  r = await req(jar, 'GET', '/brouillons/' + idBrouillon);
  const mSujet = r.texte.match(/<strong>([^<]+)<\/strong>/);
  const marqueBrouillon = mSujet ? new RegExp(mSujet[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /Brouillon/;
  await testerCycleArchivage(jar, 'brouillon', {
    liste: '/brouillons', fiche: '/brouillons/' + idBrouillon, marque: marqueBrouillon,
    archiver: `/brouillons/${idBrouillon}/archiver`, desarchiver: `/brouillons/${idBrouillon}/desarchiver`,
    journalAction: 'brouillon_archive',
  });

  // ---- 11. Anciennes routes de suppression → 404 ---------------------------------------------
  console.log('11. Anciennes routes supprimer → 404');
  const anciennes = [
    `/clients/${idEnt}/supprimer`, `/taches/${idTache}/supprimer`, `/leads/${idLead}/supprimer`,
    `/campagnes/${idCamp}/supprimer`, `/reunions/${idReu}/supprimer`, `/reclamations/${idRec}/supprimer`,
    `/polices/${idPolice}/supprimer`, `/brouillons/${idBrouillon}/supprimer`,
    `/polices/${idPolice}/protections/${mProt ? mProt[1] : 999}/supprimer`,
  ];
  for (const chemin of anciennes) {
    r = await req(jar, 'POST', chemin, { form: { _csrf: csrf((await req(jar, 'GET', '/clients/' + idEnt)).texte) || '' } });
    test(`POST ${chemin} → 404`, r.statut === 404, r.statut);
  }

  // ---- 12. Désactivation d'utilisateur --------------------------------------------------------
  console.log('12. Désactivation utilisateur');
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: csrf(r.texte), nom: 'Temp Desactive', email: 'temp@desactive.ca',
    cabinet_id: '1', role: 'courtier', mot_de_passe: 'TempDesact789!',
  }});
  test('création utilisateur → 302', r.statut === 302, r.statut);

  const jarTemp = nouveauJar();
  r = await req(jarTemp, 'GET', '/connexion');
  r = await req(jarTemp, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'temp@desactive.ca', mot_de_passe: 'TempDesact789!' } });
  test('login avant désactivation → 302', r.statut === 302, r.statut);
  r = await req(jarTemp, 'GET', '/mot-de-passe');
  await req(jarTemp, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'TempDesact789!', nouveau: 'TempDesact456!', confirmation: 'TempDesact456!' } });

  // Trouver l'id de l'utilisateur via la liste admin
  r = await req(jar, 'GET', '/admin/utilisateurs');
  const mUser = r.texte.match(/temp@desactive\.ca[\s\S]*?\/admin\/utilisateurs\/(\d+)\/desactiver/);
  test('utilisateur listé avec colonne Actif', !!mUser && /Actif/.test(r.texte));
  const idTemp = mUser[1];
  r = await req(jar, 'POST', `/admin/utilisateurs/${idTemp}/desactiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/admin/utilisateurs')).texte) || '' } });
  test('désactivation → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/admin/journal');
  test('désactivation journalisée', /utilisateur_desactive/.test(r.texte));

  const jarTemp2 = nouveauJar();
  r = await req(jarTemp2, 'GET', '/connexion');
  r = await req(jarTemp2, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'temp@desactive.ca', mot_de_passe: 'TempDesact456!' } });
  test('login refusé après désactivation → 401', r.statut === 401 && /désactivé/.test(r.texte), r.statut);

  // Session existante invalidée
  r = await req(jarTemp, 'GET', '/echeances');
  test('session existante coupée après désactivation', r.statut === 401 || r.statut === 302, r.statut);

  r = await req(jar, 'POST', `/admin/utilisateurs/${idTemp}/activer`, { form: { _csrf: csrf((await req(jar, 'GET', '/admin/utilisateurs')).texte) || '' } });
  test('réactivation → 302', r.statut === 302, r.statut);
  const jarTemp3 = nouveauJar();
  r = await req(jarTemp3, 'GET', '/connexion');
  r = await req(jarTemp3, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'temp@desactive.ca', mot_de_passe: 'TempDesact456!' } });
  test('login OK après réactivation → 302', r.statut === 302, r.statut);

  // On ne peut pas se désactiver soi-même
  r = await req(jar, 'POST', '/admin/utilisateurs/1/desactiver', { form: { _csrf: csrf((await req(jar, 'GET', '/admin/utilisateurs')).texte) || '' } });
  test('auto-désactivation refusée → 400', r.statut === 400, r.statut);

  // ---- 13. Cloisonnement des archives -----------------------------------------------------------
  console.log('13. Cloisonnement');
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/cabinets', { form: { _csrf: csrf(r.texte), nom: 'Cabinet Test Isolement 2' } });
  test('2e cabinet créé', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: csrf(r.texte), nom: 'Cab2 Test', email: 'cab2@principes.ca',
    cabinet_id: '2', role: 'courtier', mot_de_passe: 'Cab2Principes789!',
  }});
  test('utilisateur cab2 créé', r.statut === 302, r.statut);
  const jar2 = nouveauJar();
  r = await req(jar2, 'GET', '/connexion');
  r = await req(jar2, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'cab2@principes.ca', mot_de_passe: 'Cab2Principes789!' } });
  r = await req(jar2, 'GET', '/mot-de-passe');
  await req(jar2, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'Cab2Principes789!', nouveau: 'Cab2Principes456!', confirmation: 'Cab2Principes456!' } });

  // Archiver la tâche puis vérifier que cab2 ne la voit ni active ni archivée
  r = await req(jar, 'POST', `/taches/${idTache}/archiver`, { form: { _csrf: csrf((await req(jar, 'GET', '/taches/' + idTache + '/modifier')).texte) || '' } });
  test('tâche archivée (prépa cloisonnement)', r.statut === 302, r.statut);
  r = await req(jar2, 'GET', '/taches?archives=1');
  test('cab2 ne voit pas les archives du cab1', r.statut === 200 && !/Tâche Archivage Test/.test(r.texte));
  r = await req(jar2, 'POST', `/taches/${idTache}/desarchiver`, { form: { _csrf: csrf((await req(jar2, 'GET', '/taches/nouvelle')).texte) || '' } });
  test('cab2 ne peut pas désarchiver la tâche du cab1 → 404', r.statut === 404, r.statut);
  r = await req(jar2, 'GET', `/polices/${idPolice}/versions/1`);
  test('cab2 ne voit pas les versions de police du cab1 → 404', r.statut === 404, r.statut);

  console.log('');
  if (echecs === 0) console.log('🎉 TOUS LES TESTS PASSENT');
  else { console.log(`❌ ${echecs} ÉCHEC(S)`); process.exitCode = 1; }
})();
