/**
 * scripts/test-combine-etape1.js — Étape 1/10 « Soumission combinée » :
 * en-tête d'envoi du cabinet + fiche entreprise complète.
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE, MÊME
 * CHEMIN_BD que le serveur. Usage : PORT=3101 CHEMIN_BD=... node scripts/test-combine-etape1.js
 */
const { execFileSync } = require('child_process');
const path = require('path');
const bd = require('../lib/bd');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0, total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
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
  return { statut: res.status, texte: await res.text(), location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

(async () => {
  console.log('== Étape 1/10 combinée — en-tête cabinet + fiche entreprise :', BASE);

  // ---- 1. Connexion admin ---------------------------------------------------
  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login admin → 302', r.statut === 302, String(r.statut));
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));

  // ---- 2. En-tête d'envoi du cabinet -----------------------------------------
  const cabinet = bd.prepare("SELECT * FROM cabinets WHERE nom = 'Cabinet Démo'").get();
  test('cabinet démo présent', !!cabinet);
  r = await req(jar, 'GET', '/admin/cabinets');
  test('page cabinets → 200', r.statut === 200, String(r.statut));
  test('formulaire d\u2019en-tête présent', r.texte.includes('En-tête d\u2019envoi'));
  r = await req(jar, 'POST', `/admin/cabinets/${cabinet.id}/entete`, {
    form: {
      _csrf: csrf(r.texte), adresse: '100 rue des Tests', ville: 'Laval',
      code_postal: 'H7T 0B3', telephone: '(450) 555-0100', telecopieur: '(450) 555-0101',
      site_web: 'https://cabinet-exemple.ca', courriel: 'info@cabinet-exemple.ca',
    },
  });
  test('POST en-tête → 302', r.statut === 302, String(r.statut));
  const cabApres = bd.prepare('SELECT * FROM cabinets WHERE id = ?').get(cabinet.id);
  test('en-tête enregistré (adresse + téléphone + courriel)',
    cabApres.adresse === '100 rue des Tests' && cabApres.telephone === '(450) 555-0100'
    && cabApres.courriel === 'info@cabinet-exemple.ca' && cabApres.telecopieur === '(450) 555-0101');

  // ---- 3. Création d'entreprise avec le profil complet -----------------------
  r = await req(jar, 'GET', '/clients/nouveau');
  test('formulaire entreprise → 200', r.statut === 200, String(r.statut));
  test('section profil de souscription présente', r.texte.includes('Profil de souscription'));
  test('champ année de fondation présent', r.texte.includes('name="annee_fondation"'));
  r = await req(jar, 'POST', '/clients', {
    form: {
      _csrf: csrf(r.texte),
      raison_sociale: 'Entreprise Test Combinée inc.', prenom: 'Pat', nom: 'Rimoine',
      langue: 'FR', forme_juridique: 'societe_actions', annee_fondation: '1998',
      annees_experience_liee: '12', noms_exploitation: 'ETC Distribution',
      code_industrie: '1812', code_industrie_description: 'Habitations n.d.a.',
      code_industrie_pct_revenus: '100', masse_salariale: '420000',
      nb_employes_temps_plein: '7', nb_employes_temps_partiel: '2',
      employes_csst: 'on', pct_sous_traitance: '10',
      description_activites: 'Nettoyage après sinistre et travaux légers.',
      rep_geo_canada: '80', rep_geo_etats_unis: '20',
      rep_type_detail: '60', rep_type_reparation: '40',
    },
  });
  test('création entreprise → 302', r.statut === 302, String(r.statut));
  const idClient = Number((r.location || '').split('/').pop());
  const cl = bd.prepare('SELECT * FROM clients WHERE id = ?').get(idClient);
  test('client créé', !!cl);
  test('forme juridique enregistrée', cl.forme_juridique === 'societe_actions');
  test('année de fondation enregistrée', cl.annee_fondation === 1998);
  test('expérience liée enregistrée', cl.annees_experience_liee === 12);
  test('employés plein/partiel enregistrés', cl.nb_employes_temps_plein === 7 && cl.nb_employes_temps_partiel === 2);
  test('CSST coché = 1, alcool non coché = 0', cl.employes_csst === 1 && cl.responsabilite_alcool === 0);
  test('masse salariale et sous-traitance enregistrées', cl.masse_salariale === 420000 && cl.pct_sous_traitance === 10);
  const repGeo = JSON.parse(cl.repartition_revenus_geo || '{}');
  const repTypes = JSON.parse(cl.repartition_revenus_types || '{}');
  test('répartition géographique en JSON (80/20)', repGeo.canada === 80 && repGeo.etats_unis === 20);
  test('répartition par type en JSON (60/40)', repTypes.detail === 60 && repTypes.reparation === 40);

  // ---- 4. Formulaire de modification pré-rempli -------------------------------
  r = await req(jar, 'GET', `/clients/${idClient}/modifier`);
  test('formulaire modification → 200', r.statut === 200, String(r.statut));
  test('année de fondation pré-remplie', /name="annee_fondation"[^>]*value="1998"/.test(r.texte));
  test('répartition géo pré-remplie (canada 80)', /name="rep_geo_canada"[^>]*value="80"/.test(r.texte));
  test('forme juridique sélectionnée', r.texte.includes('<option value="societe_actions" selected>'));

  // ---- 5. Fiche entreprise -----------------------------------------------------
  r = await req(jar, 'GET', `/clients/${idClient}`);
  test('fiche entreprise → 200', r.statut === 200, String(r.statut));
  test('fiche : « En affaire depuis » 1998 affiché', r.texte.includes('En affaire depuis') && r.texte.includes('1998'));
  test('fiche : forme juridique affichée', r.texte.includes('Société par actions'));

  // ---- 6. Validation ------------------------------------------------------------
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', {
    form: {
      _csrf: csrf(r.texte), raison_sociale: 'Forme Invalide inc.', prenom: 'A', nom: 'B',
      langue: 'FR', forme_juridique: 'pas_une_forme',
    },
  });
  test('forme juridique invalide → 400', r.statut === 400, String(r.statut));

  // ---- 7. Dictionnaire ---------------------------------------------------------
  const sortie = execFileSync('node', [path.join(__dirname, 'generer-dictionnaire.js')], {
    encoding: 'utf8',
    env: { ...process.env, CHEMIN_BD: process.env.CHEMIN_BD },
  });
  test('dictionnaire complet et cohérent — état final (99 tables, 1391 colonnes)',
    /99 tables, 1391 colonnes/.test(sortie), sortie.trim().slice(0, 120));

  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
  console.log('🎉 TOUS LES TESTS PASSENT');
})().catch((e) => { console.error(e); process.exit(1); });
