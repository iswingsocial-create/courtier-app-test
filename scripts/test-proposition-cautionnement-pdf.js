/**
 * scripts/test-proposition-cautionnement-pdf.js — Proposition cautionnement
 * pré-remplie HTML + PDF (étape 7/10 cautionnement) : données complètes
 * (principal + profil, obligations enrichies avec libellés FR, ligne de
 * cautionnement, antécédents, consentements), mention métier obligatoire
 * (retournement contre le principal), état courant OU version figée ?v=N,
 * snapshot immuable, lecture seule, bouton activé seulement quand la
 * soumission est complète, audit proposition_cautionnement_generee,
 * cloisonnement inter-cabinets et portefeuille courtier.
 * Miroir de scripts/test-proposition-flotte-pdf.js.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE (seed).
 * Usage : CHEMIN_BD=<même que serveur> PORT=3101 node scripts/test-proposition-cautionnement-pdf.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || './courtier.db';
const fs = require('fs');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bd = new Database(process.env.CHEMIN_BD);
const caut = require('../lib/cautionnement');

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
  return paires.length ? { Cookie: paires.join('; ') } : {};
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
  const buf = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, texte: buf.toString('utf8'), buf, contentType: res.headers.get('content-type') || '', location: res.headers.get('location') };
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
async function loginComme(email, mdp) {
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
  return { jar, ok: r.statut === 302 };
}
function textePdf(buf) {
  const brut = buf.toString('latin1');
  const morceaux = [];
  const re = /<([0-9A-Fa-f]+)>/g;
  let m;
  while ((m = re.exec(brut))) {
    try { morceaux.push(Buffer.from(m[1], 'hex').toString('latin1')); } catch { /* ignore */ }
  }
  return morceaux.join('');
}
const norm = (t) => String(t).replace(/[  ]/g, ' ');

(async () => {
  console.log('== Proposition cautionnement HTML + PDF (étape 7/10) ==');

  // ---- Préparation directe ---------------------------------------------------
  const cabA = bd.prepare("SELECT id FROM cabinets WHERE nom = 'Cabinet Démo'").get().id;
  const cabB = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Prop B').lastInsertRowid;
  const hash = bcrypt.hashSync('Test1234!', 4);
  const adminA = bd.prepare("SELECT id FROM users WHERE email = 'admin@demo.ca'").get().id;
  bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'admin', ?)")
    .run(cabB, 'adminpb@t.ca', hash, 'Admin PB');
  const courtier1 = bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtierp1@t.ca', hash, 'Courtier P1').lastInsertRowid;
  const courtier2 = bd.prepare("INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, ?, ?, 'courtier', ?)")
    .run(cabA, 'courtierp2@t.ca', hash, 'Courtier P2').lastInsertRowid;
  const cli = bd.prepare('INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, adresse, ville, code_postal, responsable_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cabA, 'Proposition Caut inc.', 'Pro', 'Position', '100 rue Test', 'Laval', 'H7L 1A1', courtier2).lastInsertRowid;
  const sId = caut.creerSoumission({
    cabinetId: cabA, userId: adminA, clientId: cli,
    assureur: 'Intact Cautionnement', secteurActivite: 'Construction — entrepreneur général',
    anneeFondation: 2011, chiffreAffaires: 5400000, nbEmployes: 30,
    dateEffetSouhaitee: '2026-12-01', notes: 'Test proposition cautionnement',
  });
  caut.ajouterObligation(sId, cabA, adminA, {
    type: 'execution', beneficiaire: 'Centre de services scolaire Prop',
    description_projet: 'Construction école primaire Prop',
    montant_contrat: 2200000, montant_cautionnement: 1100000, taux_pct: 1.25, prime_estimee: 13750,
  });
  caut.ajouterObligation(sId, cabA, adminA, {
    type: 'soumission', beneficiaire: 'Ville Prop',
    description_projet: 'Soumission — réfection bibliothèque',
    montant_contrat: 2200000, montant_cautionnement: 220000, prime_estimee: 300,
  });
  caut.definirGaranties(sId, cabA, adminA, {
    limite_globale: 5000000, limite_par_projet: 2500000,
    fonds_roulement: 800000, valeur_nette: 1700000, prime: 19500,
  });
  caut.definirAntecedents(sId, cabA, adminA, {
    assureur_actuel: 'Ancienne Caution Prop', numero_ligne_actuelle: 'LIG-PROP-1',
    annees_cautionnement_continu: 5,
    reclamations_5ans: [{ date: '2022-06-20', cautionnement: 'Exécution — Ville Q', montant: 38000, statut: 'réglée' }],
    refus_resiliation_ant: 0,
    consentements: { credit: 1, etats_financiers: 1 },
  });
  const nbVersions = caut.versionsSoumission(sId, cabA)[0].version;
  test('préparation directe OK', sId > 0 && nbVersions >= 5, `versions=${nbVersions}`);
  // Soumission incomplète : aucune obligation ni ligne.
  const sVide = caut.creerSoumission({ cabinetId: cabA, userId: adminA, clientId: cli });
  test('soumission vide créée', sVide > 0);

  // ---- 1. Login ------------------------------------------------------------------
  console.log('1. Login');
  const { jar, ok } = await loginComme('admin@demo.ca', 'ChangeMoi123!');
  test('login démo → 302', ok);
  let r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'PropCaut456!', confirmation: 'PropCaut456!' } });
  test('changement mdp → 302', r.statut === 302, r.statut);

  // ---- 2. Bouton sur la fiche ------------------------------------------------------
  console.log('2. Bouton proposition');
  r = await req(jar, 'GET', '/cautionnement/' + sId);
  test('fiche complète → 200', r.statut === 200, r.statut);
  test('bouton Proposition actif (lien)', new RegExp(`href="/cautionnement/${sId}/proposition"`).test(r.texte));
  test('lien PDF présent', new RegExp(`href="/cautionnement/${sId}/proposition\\.pdf"`).test(r.texte));
  test('plus de bouton (bientôt)', !r.texte.includes('Proposition (bientôt)'));
  r = await req(jar, 'GET', '/cautionnement/' + sVide);
  test('fiche vide : aucun lien proposition', !new RegExp(`href="/cautionnement/${sVide}/proposition"`).test(r.texte));

  // ---- 3. Proposition HTML courante ---------------------------------------------------
  console.log('3. Proposition HTML');
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition`);
  const html = norm(r.texte);
  test('GET proposition → 200', r.statut === 200, r.statut);
  test('titre proposition cautionnement', /Proposition de cautionnement/.test(html));
  test('entreprise cliente présente', /Proposition Caut inc\./.test(html));
  test('profil : secteur + fondation + CA', html.includes('entrepreneur général') && html.includes('2011') && /5\s400\s000\s\$/.test(html));
  test('caution visée présente', html.includes('Intact Cautionnement'));
  test('résumé : 2 obligations détaillées', /Obligations détaillées<\/dt><dd><strong>2<\/strong>/.test(html));
  test('résumé : somme des cautionnements 1 320 000 $', /1\s320\s000\s\$/.test(html));
  test('résumé : utilisation de la capacité (26,4 %)', /26,4 % de la limite globale/.test(html));
  test('obligation : bénéficiaire + projet', html.includes('Centre de services scolaire Prop') && html.includes('Construction école primaire Prop'));
  test('obligation : type en libellé FR', html.includes('Cautionnement d’exécution (performance bond)') && html.includes('Cautionnement de soumission (bid bond)'));
  test('obligation : 50 % du contrat', /50 % du contrat/.test(html));
  test('obligation : montants formatés', /2\s200\s000\s\$/.test(html) && /1\s100\s000\s\$/.test(html));
  test('jamais les codes bruts', !/\bpaiement_mo\b/.test(html) && !/>execution</.test(html) && !/>rbq</.test(html));
  test('ligne : limite globale 5 000 000 $', /Limite globale \(capacité totale\)<\/dt><dd><strong>5\s000\s000\s\$<\/strong>/.test(html));
  test('ligne : limite par projet + fonds de roulement', /2\s500\s000\s\$/.test(html) && /800\s000\s\$/.test(html));
  test('ligne : prime 19 500 $', /19\s500\s\$/.test(html));
  test('mention métier exacte (retournement contre le principal)',
    html.replace(/&#39;/g, "'").includes("Un cautionnement n'est pas une assurance: la caution qui paie le bénéficiaire se retourne contre le principal (convention d'indemnisation signée par les actionnaires)."));
  test('mention métier : capacité après analyse des états financiers',
    html.replace(/&#39;/g, "'").includes('La limite globale et la limite par projet forment la capacité accordée après analyse des états financiers.'));
  test('antécédents : réclamation présente', html.includes('Ville Q') && /38\s000\s\$/.test(html));
  test('antécédents : caution actuelle + 5 ans continus', html.includes('Ancienne Caution Prop'));
  test('consentements présents', html.includes('Dossier de crédit') && html.includes('États financiers (2-3 ans)'));
  test('mention version + vérification', new RegExp(`soumission cautionnement #${sId}.*version v${nbVersions}`, 's').test(html) && /vérifiez avant envoi/.test(html));
  test('bouton Imprimer + lien PDF', /data-action="imprimer"/.test(html) && /src="\/proposition\.js"/.test(html)
    && new RegExp(`/cautionnement/${sId}/proposition\\.pdf`).test(html));
  test('CSS externe (CSP)', /href="\/proposition\.css"/.test(html));

  // ---- 4. Versions figées ---------------------------------------------------------------
  console.log('4. Versions figées');
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition?v=1`);
  test('?v=1 → 200 + mention figée', r.statut === 200 && /\(figée\)/.test(r.texte), r.statut);
  test('?v=1 = données d’époque (aucune obligation)', /Aucune obligation saisie\./.test(r.texte));
  caut.ajouterObligation(sId, cabA, adminA, {
    type: 'rbq', beneficiaire: 'Régie du bâtiment du Québec (RBQ)',
    description_projet: 'Licence RBQ — ajout après coup', montant_cautionnement: 40000, prime_estimee: 250,
  });
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition?v=${nbVersions}`);
  test(`?v=${nbVersions} = snapshot (2 obligations, sans la RBQ)`,
    /Obligations détaillées<\/dt><dd><strong>2<\/strong>/.test(norm(r.texte)) && !norm(r.texte).includes('Licence RBQ — ajout après coup'));
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition`);
  test('courante = 3 obligations (avec la RBQ)', /Obligations détaillées<\/dt><dd><strong>3<\/strong>/.test(norm(r.texte))
    && norm(r.texte).includes('Cautionnement de licence RBQ'));
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition?v=999`);
  test('?v=999 → 404', r.statut === 404, r.statut);
  r = await req(jar, 'GET', '/cautionnement/99999/proposition');
  test('soumission inexistante → 404', r.statut === 404, r.statut);
  const versionsApresAjout = caut.versionsSoumission(sId, cabA).length;

  // ---- 5. PDF ------------------------------------------------------------------------------
  console.log('5. PDF');
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition.pdf`);
  test('GET PDF → 200', r.statut === 200, r.statut);
  test('content-type PDF', r.contentType.includes('application/pdf'), r.contentType);
  test('en-tête %PDF', r.buf.slice(0, 4).toString() === '%PDF');
  const contenuPdf = textePdf(r.buf);
  test('entreprise dans le PDF', contenuPdf.includes('Proposition Caut'));
  test('bénéficiaire dans le PDF', contenuPdf.includes('Centre de services scolaire Prop'));
  test('mention métier dans le PDF', contenuPdf.includes("n'est pas une assurance") || contenuPdf.includes('pas une assurance'));
  test('section obligations dans le PDF', contenuPdf.includes('Obligations'));
  test('taille PDF raisonnable', r.buf.length > 3000, `${r.buf.length} octets`);
  r = await req(jar, 'GET', `/cautionnement/${sId}/proposition.pdf?v=1`);
  test('PDF figé ?v=1 → 200 + aucune obligation', r.statut === 200
    && r.buf.slice(0, 4).toString() === '%PDF' && textePdf(r.buf).includes('Aucune'), r.statut);

  // ---- 6. Règle d'or ---------------------------------------------------------------------------
  console.log('6. Règle d’or');
  test('générations en lecture seule (aucune version créée)',
    caut.versionsSoumission(sId, cabA).length === versionsApresAjout,
    `${versionsApresAjout} → ${caut.versionsSoumission(sId, cabA).length}`);
  const srcProp = fs.readFileSync(__dirname + '/../lib/proposition-cautionnement.js', 'utf8')
    + fs.readFileSync(__dirname + '/../lib/proposition-cautionnement-pdf.js', 'utf8');
  test('aucun DELETE dans les modules proposition cautionnement', !/DELETE\s+FROM/i.test(srcProp));

  // ---- 7. Sécurité --------------------------------------------------------------------------------
  console.log('7. Sécurité');
  const { jar: jarB } = await loginComme('adminpb@t.ca', 'Test1234!');
  r = await req(jarB, 'GET', `/cautionnement/${sId}/proposition`);
  test('inter-cabinets → 404 (aucune fuite)', r.statut === 404, r.statut);
  r = await req(jarB, 'GET', `/cautionnement/${sId}/proposition.pdf`);
  test('inter-cabinets PDF → 404 (aucune fuite)', r.statut === 404, r.statut);
  const { jar: jarC1 } = await loginComme('courtierp1@t.ca', 'Test1234!');
  r = await req(jarC1, 'GET', `/cautionnement/${sId}/proposition`);
  test('courtier hors portefeuille → 403', r.statut === 403, r.statut);
  const { jar: jarC2 } = await loginComme('courtierp2@t.ca', 'Test1234!');
  r = await req(jarC2, 'GET', `/cautionnement/${sId}/proposition`);
  test('courtier du portefeuille → 200', r.statut === 200, r.statut);
  r = await req(nouveauJar(), 'GET', `/cautionnement/${sId}/proposition`);
  test('sans login → 302 vers connexion', r.statut === 302, r.statut);

  // ---- 8. Audit ---------------------------------------------------------------------------------------
  console.log('8. Audit');
  const audits = bd.prepare(
    "SELECT details FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_cautionnement_generee' ORDER BY id DESC"
  ).all(cabA);
  test('générations journalisées', audits.length >= 3, `${audits.length}`);
  test('détail avec version', audits.some((a) => new RegExp(`#${sId} \\(v${nbVersions}`).test(a.details || '')));
  const auditB = bd.prepare(
    "SELECT COUNT(*) AS n FROM journal_audit WHERE cabinet_id = ? AND action = 'proposition_cautionnement_generee'"
  ).get(cabB).n;
  test('aucune fuite audit vers cabinet B', auditB === 0);

  console.log(`\n${echecs === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${echecs} ÉCHEC(S)`} (${total} tests)`);
  bd.close();
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
