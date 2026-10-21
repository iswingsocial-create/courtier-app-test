/**
 * scripts/test-analyse-reponse.js — Boucle courriel, étape 3/5 : analyse de
 * la réponse du client.
 * Parcours COMPLET (biens) : soumission incomplète (gicleurs + superficie) →
 * demande envoyée (simulé) → réponse courriel (texte « Gicleurs : oui »,
 * « Superficie : 12 000 pi² » + pièce jointe Excel avec un 2e bâtiment) →
 * correspondance par le fil (In-Reply-To) → analyse → révision (réponses aux
 * questions affichées, soumission pré-sélectionnée) → insertion → champs
 * remplis, questions fermées, demande COMPLÉTÉE.
 * Parcours PARTIEL : réponse « Gicleurs : non » seulement → correspondance
 * par l'objet (Re:) → demande PARTIELLEMENT COMPLÉTÉE, questions restantes
 * toujours listées (la valeur 0 ferme la question gicleurs).
 * Prérequis : serveur sur PORT (3101), base FRAÎCHE, MÊME CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-reponse.db PORT=3101 node scripts/test-analyse-reponse.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-reponse.db';
const fs = require('fs');
const path = require('path');
const { fabriquerXlsx } = require('./fixtures/fabriquer-xlsx');
const bd = require('../lib/bd');
const biens = require('../lib/biens');
const demandesInfos = require('../lib/demandes-infos');
const analysesLib = require('../lib/analyses-documents');
const courrielsLib = require('../lib/courriels');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
function nouveauJar() { return {}; }
function appliquerCookies(jar, res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) {
    const [paire] = c.split(';');
    const i = paire.indexOf('=');
    if (i > 0) jar[paire.slice(0, i).trim()] = paire.slice(i + 1).trim();
  }
}
async function req(jar, methode, chemin, { form = null } = {}) {
  const entetes = {};
  const paires = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  if (paires.length) entetes.Cookie = paires.join('; ');
  let corps = null;
  if (form) {
    entetes['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) for (const x of v) params.append(k, x);
      else params.append(k, v);
    }
    corps = params.toString();
  }
  const res = await fetch(BASE + chemin, { method: methode, headers: entetes, body: corps, redirect: 'manual' });
  appliquerCookies(jar, res);
  return { statut: res.status, texte: await res.text(), location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function loginAdmin(jar) {
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  r = await req(jar, 'GET', '/mot-de-passe');
  await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
}

// Formulaire d'insertion construit depuis l'analyse stockée (indices alignés
// sur la vue : champs, cibles et listes dans l'ordre d'affichage).
function formulaireInsertion(a, produit, soumissionId, jeton) {
  const form = { _csrf: jeton, cible: 'soumission_existante', produit, soumission_existante: `${produit}:${soumissionId}` };
  a.reponsesCiblees.forEach((c, i) => {
    form[`cible_${i}_inclure`] = 'on';
    form[`cible_${i}_valeur`] = String(c.valeur);
  });
  const META = require('../lib/analyse-document').META_LISTES;
  for (const [type, items] of Object.entries(a.listes || {})) {
    const meta = META[type];
    if (!meta) continue;
    items.forEach((item, i) => {
      form[`liste_${type}_${i}_inclure`] = 'on';
      for (const cle of Object.keys(meta.champs)) {
        form[`liste_${type}_${i}_${cle}`] = item.champs[cle] != null ? String(item.champs[cle]) : '';
      }
    });
  }
  return form;
}

(async () => {
  console.log('== Boucle courriel — étape 3 : analyse de la réponse ==');
  const cab = bd.prepare('SELECT id FROM cabinets ORDER BY id LIMIT 1').get();
  const cabId = cab.id;
  const admin = bd.prepare("SELECT * FROM users WHERE cabinet_id = ? AND role = 'admin' ORDER BY id LIMIT 1").get(cabId);
  const utilisateur = { id: admin.id, nom: admin.nom, cabinet_id: cabId, role: 'admin' };

  const jar = nouveauJar();
  await loginAdmin(jar);

  // ---------- CAS COMPLET ----------
  console.log('— Cas complet (biens) —');
  const clientId = bd.prepare(
    "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, responsable_id) VALUES (?, 'Garage Réponse inc.', '', '', 'info@garagereponse.ca', ?)"
  ).run(cabId, admin.id).lastInsertRowid;
  const sId = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId, dateEffetSouhaitee: '2026-12-01' });
  const batId = biens.ajouterBatiment(sId, cabId, admin.id, {
    adresse: '1200 boul. Industriel', ville: 'Laval', code_postal: 'H7M 2H6',
    type_construction: 'acier', annee_construction: 1998, nb_etages: 2,
    occupation: 'Garage', valeur_batiment: 850000, chauffage: 'gaz',
    annee_toiture: 2019, distance_caserne_km: 3.5,
    // gicleurs et superficie_pi2 volontairement absents : les 2 seuls manques.
  });
  biens.ajouterContenu(sId, cabId, admin.id, { description: 'Équipements', type_contenu: 'equipements', valeur: 200000 }, batId);
  biens.definirGaranties(batId, cabId, admin.id, { formule: 'tous_risques', montant_assurance: 850000, franchise: 1000, prime: 4200 });
  biens.definirAntecedents(sId, cabId, admin.id, { assureur_actuel: 'Intact Assurance', sinistres_5ans: [] });

  const demandeId = demandesInfos.creerDemande(cabId, utilisateur, { produit: 'biens', soumissionId: sId });
  let demande = demandesInfos.obtenirDemande(demandeId, cabId);
  test('demande : exactement 2 questions (gicleurs, superficie)', demande.questions.length === 2, `n=${demande.questions.length} ${demande.questions.map((q) => q.cle).join(',')}`);
  const envoi = await demandesInfos.envoyerDemande(demandeId, cabId, utilisateur);
  demande = envoi.demande;
  test('envoi simulé (aucun compte SMTP dans la base de test)', envoi.mode === 'simule' && demande.statut === 'envoyee');

  // Pièce jointe Excel : un 2e bâtiment complet.
  const cheminXlsx = path.join('/tmp', 'reponse-batiments.xlsx');
  fabriquerXlsx(cheminXlsx, {
    colonnes: ['Adresse', 'Ville', 'Code postal', 'Type de construction', 'Année de construction', 'Superficie (pi²)', 'Nb d\u2019étages', 'Occupation', 'Valeur du bâtiment', 'Gicleurs', 'Distance caserne (km)', 'Chauffage', 'Année de la toiture'],
    lignes: [['450 rue des Artisans', 'Laval', 'H7M 3K2', 'Béton', '2005', '8000', '1', 'Entrepôt', '600000', 'Oui', '2.1', 'Électrique', '2021']],
  });

  // Courriel de réponse inséré comme le ferait la synchro IMAP.
  const courrielId = bd.prepare(`
    INSERT INTO courriels (cabinet_id, message_id, en_reponse_a, dossier, expediteur,
      destinataires, sujet, corps_texte, date_courriel, client_id, lu)
    VALUES (?, '<reponse-1@test>', ?, 'reception', 'Garage Réponse <info@garagereponse.ca>',
      'courtier@demo.ca', ?, ?, 'Tue, 20 Oct 2026 09:00:00 -0400', ?, 0)
  `).run(cabId, demande.message_id, `Re: ${demande.sujet}`,
    'Bonjour,\n\nVoici les réponses demandées pour notre bâtiment principal :\nGicleurs : oui, le bâtiment est protégé par des gicleurs.\nSuperficie : 12 000 pi².\n\nJe vous joins aussi le détail de notre entrepôt dans le fichier Excel.\n\nMerci !',
    clientId).lastInsertRowid;
  courrielsLib.enregistrerPieceJointe(bd, cabId, courrielId, {
    nom: 'batiments-entrepot.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contenu: fs.readFileSync(cheminXlsx),
  });
  const pjs = bd.prepare('SELECT * FROM courriel_pieces_jointes WHERE courriel_id = ?').all(courrielId);
  test('pièce jointe stockée (fichier + ligne)', pjs.length === 1 && fs.existsSync(pjs[0].chemin) && pjs[0].taille > 0);

  // Page du message : bouton d'analyse.
  let r = await req(jar, 'GET', `/courriels/${courrielId}`);
  test('message : bouton « Analyser la réponse »', r.statut === 200 && r.texte.includes('Analyser la réponse'));

  // Page de correspondance : détectée par le fil.
  r = await req(jar, 'GET', `/courriels/${courrielId}/analyser-reponse`);
  test('correspondance : demande détectée automatiquement (fil)', r.statut === 200 && r.texte.includes(`demande #${demandeId}`), `statut=${r.statut}`);

  // Analyse.
  r = await req(jar, 'POST', `/courriels/${courrielId}/analyser-reponse`, {
    form: { _csrf: csrf(r.texte), demande_id: String(demandeId) },
  });
  test('analyse → 302 vers /analyses/<id>', r.statut === 302 && /^\/analyses\/\d+$/.test(r.location || ''), `statut=${r.statut} loc=${r.location}`);
  const analyseId = Number((r.location || '').split('/').pop());
  const a = analysesLib.obtenirAnalyse(analyseId, cabId);
  test('analyse liée à la demande et au courriel', a.demande_info_id === demandeId && a.courriel_id === courrielId);
  test('analyse : produit = biens (celui de la demande)', a.produit_detecte === 'biens', a.produit_detecte);
  const cibleGicleurs = a.reponsesCiblees.find((c) => c.champ === 'gicleurs');
  const cibleSuperficie = a.reponsesCiblees.find((c) => c.champ === 'superficie_pi2');
  test('réponse ciblée gicleurs = 1 (oui)', !!cibleGicleurs && cibleGicleurs.valeur === 1 && cibleGicleurs.id === batId, JSON.stringify(cibleGicleurs));
  test('réponse ciblée superficie = 12000 pi²', !!cibleSuperficie && cibleSuperficie.valeur === 12000, JSON.stringify(cibleSuperficie));
  test('liste bâtiments extraite de la pièce jointe Excel', (a.listes.batiments || []).length === 1,
    `types=${Object.keys(a.listes || {}).join(',')}`);
  const auditRep = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'reponse_analysee'").get(cabId);
  test('audit reponse_analysee', auditRep.n >= 1);

  // Révision : réponses aux questions + cible pré-sélectionnée.
  r = await req(jar, 'GET', `/analyses/${analyseId}`);
  test('révision : section « Réponses aux questions posées »', r.texte.includes('Réponses aux questions posées'));
  test('révision : source « Réponse courriel » affichée', r.texte.includes('Réponse courriel'));
  test('révision : soumission de la demande pré-sélectionnée', r.texte.includes(`value="biens:${sId}" selected`));
  test('révision : lien vers la demande affiché', r.texte.includes(`demande d'informations #${demandeId}`));

  // Insertion.
  r = await req(jar, 'POST', `/analyses/${analyseId}/inserer`, {
    form: formulaireInsertion(a, 'biens', sId, csrf(r.texte)),
  });
  test('insertion → 302 ?insere=1', r.statut === 302 && /insere=1/.test(r.location || ''), `statut=${r.statut} loc=${r.location}`);
  const sApres = biens.obtenirSoumission(sId, cabId);
  const batApres = sApres.batiments.find((b) => b.id === batId);
  test('bâtiment : gicleurs = 1 après insertion', batApres && batApres.gicleurs === 1, `gicleurs=${batApres && batApres.gicleurs}`);
  test('bâtiment : superficie = 12000 pi² après insertion', batApres && Number(batApres.superficie_pi2) === 12000, `sup=${batApres && batApres.superficie_pi2}`);
  test('2e bâtiment ajouté depuis la pièce jointe Excel', sApres.batiments.length === 2
    && sApres.batiments.some((b) => b.adresse === '450 rue des Artisans'));
  const manquesApres = require('../lib/manques').calculerManques('biens', sApres);
  test('manques du bâtiment d\u2019origine tous résolus (restent contenus + garanties du bâtiment ajouté)',
    manquesApres.length === 2 && manquesApres.every((m) => m.cle.includes(`:${sApres.batiments.find((b) => b.adresse === '450 rue des Artisans').id}`)),
    manquesApres.map((m) => m.cle).join(','));
  demande = demandesInfos.obtenirDemande(demandeId, cabId);
  test('demande COMPLÉTÉE, toutes questions répondues', demande.statut === 'completee'
    && demande.questions.every((q) => q.statut === 'repondue' && q.repondu_le), demande.statut);
  const auditFin = bd.prepare("SELECT COUNT(*) n FROM journal_audit WHERE cabinet_id = ? AND action = 'demande_info_completee'").get(cabId);
  test('audit demande_info_completee', auditFin.n >= 1);

  // ---------- CAS PARTIEL ----------
  console.log('— Cas partiel (réponse incomplète) —');
  const s2 = biens.creerSoumission({ cabinetId: cabId, userId: admin.id, clientId, notes: 'Partiel' });
  const bat2 = biens.ajouterBatiment(s2, cabId, admin.id, { adresse: '88 rue Partielle', ville: 'Terrebonne' });
  const demande2Id = demandesInfos.creerDemande(cabId, utilisateur, { produit: 'biens', soumissionId: s2 });
  await demandesInfos.envoyerDemande(demande2Id, cabId, utilisateur);
  const demande2 = demandesInfos.obtenirDemande(demande2Id, cabId);
  const courriel2Id = bd.prepare(`
    INSERT INTO courriels (cabinet_id, message_id, dossier, expediteur, destinataires, sujet, corps_texte, date_courriel, client_id, lu)
    VALUES (?, '<reponse-2@test>', 'reception', 'Garage Réponse <info@garagereponse.ca>', 'courtier@demo.ca', ?, ?, 'Tue, 20 Oct 2026 10:00:00 -0400', ?, 0)
  `).run(cabId, `Re: ${demande2.sujet}`,
    'Bonjour, pour le bâtiment de Terrebonne : Gicleurs : non, il n\u2019y en a pas. Pour le reste, je dois vérifier avec mon comptable.',
    clientId).lastInsertRowid;

  // Correspondance par l'objet seulement (pas d'en_reponse_a).
  r = await req(jar, 'GET', `/courriels/${courriel2Id}/analyser-reponse`);
  test('correspondance : demande détectée par l\u2019objet (Re:)', r.statut === 200 && r.texte.includes(`demande #${demande2Id}`), `statut=${r.statut}`);
  r = await req(jar, 'POST', `/courriels/${courriel2Id}/analyser-reponse`, {
    form: { _csrf: csrf(r.texte), demande_id: String(demande2Id) },
  });
  const analyse2Id = Number((r.location || '').split('/').pop());
  const a2 = analysesLib.obtenirAnalyse(analyse2Id, cabId);
  const cible2 = a2.reponsesCiblees.find((c) => c.champ === 'gicleurs');
  test('réponse ciblée gicleurs = 0 (non)', !!cible2 && cible2.valeur === 0, JSON.stringify(cible2));
  r = await req(jar, 'GET', `/analyses/${analyse2Id}`);
  r = await req(jar, 'POST', `/analyses/${analyse2Id}/inserer`, {
    form: formulaireInsertion(a2, 'biens', s2, csrf(r.texte)),
  });
  test('insertion partielle → 302', r.statut === 302, `statut=${r.statut}`);
  const s2Apres = biens.obtenirSoumission(s2, cabId);
  const bat2Apres = s2Apres.batiments.find((b) => b.id === bat2);
  test('bâtiment partiel : gicleurs = 0 écrit', bat2Apres && bat2Apres.gicleurs === 0);
  const demande2Apres = demandesInfos.obtenirDemande(demande2Id, cabId);
  test('demande PARTIELLEMENT COMPLÉTÉE', demande2Apres.statut === 'partiellement_completee', demande2Apres.statut);
  const qGicleurs = demande2Apres.questions.find((q) => q.cle.endsWith(':gicleurs'));
  test('question gicleurs fermée malgré la valeur 0', !!qGicleurs && qGicleurs.statut === 'repondue');
  test('questions restantes toujours en attente', demande2Apres.nbRestantes > 0, `restantes=${demande2Apres.nbRestantes}`);
  r = await req(jar, 'GET', `/biens/${s2}`);
  test('fiche : réponse partielle + questions restantes en évidence', /Réponse partielle reçue/.test(r.texte) && /question\(s\) restante\(s\)/.test(r.texte));

  console.log(`\n${echecs === 0 ? '🎉' : '💥'} ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('💥 Erreur fatale :', e); process.exit(1); });
