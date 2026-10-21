/**
 * scripts/test-combine-etape8.js — Étape 8/10 « Soumission combinée » :
 * dossier combiné (création/liaison des 3 volets, questionnaire unique en
 * sections, synchronisation des antécédents, rattachement des emplacements).
 * HTTP + vérifications directes en base (même CHEMIN_BD que le serveur).
 * Prérequis : serveur lancé sur PORT (défaut 3101), base FRAÎCHE.
 * Usage : PORT=3101 CHEMIN_BD=... node scripts/test-combine-etape8.js
 */
const bd = require('../lib/bd');
const combine = require('../lib/combine');

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
  console.log('== Étape 8/10 combinée — dossier combiné :', BASE);

  const jar = nouveauJar();
  let r = await req(jar, 'GET', '/connexion');
  r = await req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email: 'admin@demo.ca', mot_de_passe: 'ChangeMoi123!' } });
  test('login admin → 302', r.statut === 302, String(r.statut));
  r = await req(jar, 'GET', '/mot-de-passe');
  r = await req(jar, 'POST', '/mot-de-passe', { form: { _csrf: csrf(r.texte), actuel: 'ChangeMoi123!', nouveau: 'DemoChange456!', confirmation: 'DemoChange456!' } });
  test('changement mdp → 302', r.statut === 302, String(r.statut));

  // Client de test via l'interface clients
  const cabinet = bd.prepare("SELECT * FROM cabinets WHERE nom = 'Cabinet Démo'").get();
  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', {
    form: {
      _csrf: csrf(r.texte), raison_sociale: 'Bijouterie Combinée inc.', prenom: 'Jo', nom: 'Ailler',
      courriel: 'jo@bijouterie.example', langue: 'FR',
    },
  });
  test('client créé → 302', r.statut === 302, String(r.statut) + ' ' + (r.location || ''));
  const clientId = Number((r.location || '').split('/').pop());
  test('client_id récupéré', clientId > 0, r.location);

  // Liste + page nouvelle
  r = await req(jar, 'GET', '/combinees');
  test('liste des combinées → 200', r.statut === 200 && r.texte.includes('Soumissions combinées'), String(r.statut));
  r = await req(jar, 'GET', '/combinees/nouvelle?client_id=' + clientId);
  test('page nouvelle (client choisi) → 200', r.statut === 200 && r.texte.includes('Volets du dossier'), String(r.statut));

  // Création du dossier (3 volets neufs)
  const jeton = csrf(r.texte);
  r = await req(jar, 'POST', '/combinees', {
    form: {
      _csrf: jeton, client_id: String(clientId),
      lier_biens: 'nouvelle', lier_rc: 'nouvelle', lier_perte_exploitation: 'nouvelle',
      date_effet: '2026-11-01', date_echeance: '2027-11-01', plan_paiement: 'Mensuel',
    },
  });
  test('dossier créé → 302 vers la fiche', r.statut === 302 && /^\/combinees\/\d+$/.test(r.location || ''), String(r.statut) + ' ' + (r.location || ''));
  const dossierId = Number((r.location || '').split('/').pop());

  const liens = bd.prepare('SELECT * FROM combine_liens WHERE dossier_id = ? ORDER BY produit').all(dossierId);
  test('3 liens créés (biens, pe, rc)', liens.length === 3
    && liens.map((l) => l.produit).join(',') === 'biens,perte_exploitation,rc', JSON.stringify(liens.map((l) => l.produit)));
  const idParProduit = Object.fromEntries(liens.map((l) => [l.produit, l.soumission_id]));
  const sBiens = bd.prepare('SELECT client_id FROM biens_soumissions WHERE id = ?').get(idParProduit.biens);
  const sRc = bd.prepare('SELECT client_id FROM rc_soumissions WHERE id = ?').get(idParProduit.rc);
  const sPe = bd.prepare('SELECT client_id FROM pe_soumissions WHERE id = ?').get(idParProduit.perte_exploitation);
  test('les 3 soumissions appartiennent au client', sBiens.client_id === clientId && sRc.client_id === clientId && sPe.client_id === clientId);

  // Fiche : toutes les sections du questionnaire
  r = await req(jar, 'GET', '/combinees/' + dossierId);
  test('fiche combinée → 200', r.statut === 200, String(r.statut));
  for (const section of ['En-tête du dossier', 'profil de souscription', 'Antécédents communs', 'Emplacements', 'Garanties des 3 volets', 'Questions additionnelles', 'Assurés additionnels']) {
    test('section présente : ' + section, r.texte.includes(section));
  }
  const jetonFiche = csrf(r.texte);

  // Profil entreprise
  r = await req(jar, 'POST', `/combinees/${dossierId}/profil`, {
    form: {
      _csrf: jetonFiche, forme_juridique: 'societe_actions', annee_fondation: '1998',
      annees_experience_liee: '20', description_activites: 'Bijouterie — vente et réparation',
      code_industrie: '448150', masse_salariale: '450000', nb_employes_temps_plein: '8',
      employes_csst: 'on', 'rep_geo_canada': '100',
    },
  });
  test('profil entreprise → 302', r.statut === 302, String(r.statut));
  const clientMaj = bd.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  test('profil relu en base (fondation 1998, forme juridique, CSST)',
    clientMaj.annee_fondation === 1998 && clientMaj.forme_juridique === 'societe_actions' && clientMaj.employes_csst === 1);
  test('répartition géographique relue (JSON)', JSON.parse(clientMaj.repartition_revenus_geo).canada === 100);

  // Emplacement enrichi avec voisinage
  r = await req(jar, 'POST', `/combinees/${dossierId}/emplacement`, {
    form: {
      _csrf: jetonFiche, adresse: '500 rue des Bijoux', ville: 'Montréal', code_postal: 'H3B 1A1',
      type_activite: 'Bijouterie', classe_construction: 'incombustible',
      voisin_gauche_affectation: 'Atelier de joaillerie', voisin_gauche_distance_m: '0',
      voisin_droite_affectation: 'Restaurant', voisin_droite_distance_m: '5',
      voisin_arriere_affectation: 'Stationnement', gicleurs_couverture: 'entier',
      superficie_occupee_pi2: '2400',
    },
  });
  test('emplacement ajouté → 302', r.statut === 302, String(r.statut));
  const bat = bd.prepare('SELECT * FROM biens_batiments WHERE soumission_id = ?').get(idParProduit.biens);
  test('emplacement relu (voisinage structuré + classe assureur)',
    bat && bat.voisin_gauche_affectation === 'Atelier de joaillerie' && bat.voisin_droite_distance_m === 5
    && bat.classe_construction === 'incombustible' && bat.gicleurs_couverture === 'entier');

  // Rattachements PE et RC à l'emplacement
  r = await req(jar, 'POST', `/combinees/${dossierId}/emplacement/${bat.id}/lier-pe`, {
    form: { _csrf: jetonFiche, nom_lieu: 'Bijouterie — magasin', chiffre_affaires: '900000', montant_pe: '300000' },
  });
  test('lien PE → 302', r.statut === 302, String(r.statut));
  const etab = bd.prepare('SELECT * FROM pe_etablissements WHERE soumission_id = ?').get(idParProduit.perte_exploitation);
  test('établissement PE lié à l\u2019emplacement (batiment_id + montant)',
    etab && etab.batiment_id === bat.id && etab.montant_pe === 300000);
  r = await req(jar, 'POST', `/combinees/${dossierId}/emplacement/${bat.id}/lier-rc`, {
    form: { _csrf: jetonFiche, type_activite: 'Bijouterie', chiffre_affaires: '900000' },
  });
  test('lien RC → 302', r.statut === 302, String(r.statut));
  const expl = bd.prepare('SELECT * FROM rc_exploitations WHERE soumission_id = ?').get(idParProduit.rc);
  test('lieu RC lié à l\u2019emplacement', expl && expl.batiment_id === bat.id && expl.adresse === '500 rue des Bijoux');

  // Antécédents communs → synchronisés vers les 3 produits
  const sinistres = [{ date: '2024-05-01', type: 'Vol', montant: 8000, montant_paye: 7500, reserve: 500, statut: 'Fermé', description: 'Vol par effraction' }];
  r = await req(jar, 'POST', `/combinees/${dossierId}/antecedents`, {
    form: {
      _csrf: jetonFiche, assureur_actuel: 'Intact', numero_police_actuelle: 'P-123',
      date_expiration_actuelle: '2026-10-31', annees_assurance_continue: '9',
      refus: 'on', refus_explication: 'Non-renouvellement 2022',
      type_police_precedente: 'Combinée', date_effet_precedente: '2025-11-01', prime_precedente: '21000',
      sinistres_json: JSON.stringify(sinistres),
      interruptions: '2023-02-10 | Dégât d\u2019eau | 4 | 15000',
    },
  });
  test('antécédents → 302', r.statut === 302, String(r.statut));
  const aB = bd.prepare('SELECT * FROM biens_antecedents WHERE soumission_id = ?').get(idParProduit.biens);
  const aR = bd.prepare('SELECT * FROM rc_antecedents WHERE soumission_id = ?').get(idParProduit.rc);
  const aP = bd.prepare('SELECT * FROM pe_antecedents WHERE soumission_id = ?').get(idParProduit.perte_exploitation);
  test('sync : refus + prime précédente dans les 3 tables *_antecedents',
    aB.refus_resiliation_nonrenouvellement === 1 && aR.refus_resiliation_nonrenouvellement === 1
    && aP.refus_resiliation_nonrenouvellement === 1 && aP.prime_precedente === 21000);
  test('sync : sinistres enrichis (biens + RC), interruptions (PE)',
    JSON.parse(aB.sinistres_5ans)[0].reserve === 500 && JSON.parse(aR.sinistres_5ans)[0].statut === 'Fermé'
    && JSON.parse(aP.interruptions_5ans)[0].duree_jours === 4);

  // Garanties des 3 volets via le questionnaire
  r = await req(jar, 'POST', `/combinees/${dossierId}/garanties-biens/${bat.id}`, {
    form: {
      _csrf: jetonFiche, formule: 'tous_risques', montant_assurance: '2000000', franchise: '1000',
      regle_proportionnelle: '90', franchise_contenu: '1000', regle_proportionnelle_contenu: '90',
      avenant_det_refoulement_egout: 'on', avenant_det_refoulement_egout_montant: '50000',
      avenant_det_inondation: 'on', avenant_det_inondation_franchise: '2500', avenant_det_inondation_montant: '100000',
    },
  });
  test('garanties biens → 302', r.statut === 302, String(r.statut));
  const gB = bd.prepare('SELECT * FROM biens_garanties WHERE batiment_id = ?').get(bat.id);
  const avB = JSON.parse(gB.avenants);
  test('garanties biens relues (règle prop. + avenants détaillés)',
    gB.regle_proportionnelle === 90 && avB.refoulement_egout.montant === 50000 && avB.inondation.franchise === 2500);
  r = await req(jar, 'POST', `/combinees/${dossierId}/garanties-rc/${expl.id}`, {
    form: {
      _csrf: jetonFiche, formule: 'globale', limite_par_sinistre: '2000000',
      frais_medicaux_par_personne: '25000', responsabilite_locative: '500000', umbrella_montant: '5000000',
    },
  });
  test('garanties RC → 302', r.statut === 302, String(r.statut));
  const gR = bd.prepare('SELECT * FROM rc_garanties WHERE exploitation_id = ?').get(expl.id);
  test('garanties RC relues (frais médicaux, locative, umbrella)',
    gR.frais_medicaux_par_personne === 25000 && gR.responsabilite_locative === 500000 && gR.umbrella_montant === 5000000);
  r = await req(jar, 'POST', `/combinees/${dossierId}/garanties-pe`, {
    form: {
      _csrf: jetonFiche, formule: 'benefice_brut', limite: '500000', periode_indemnite_mois: '18',
      franchise_jours: '3', base_montant: 'benefice_brut', regle_proportionnelle: '90', honoraires_comptables: '25000',
    },
  });
  test('garanties PE → 302', r.statut === 302, String(r.statut));
  const gP = bd.prepare('SELECT * FROM pe_garanties WHERE soumission_id = ?').get(idParProduit.perte_exploitation);
  test('garanties PE relues (formule, honoraires comptables)',
    gP.formule === 'benefice_brut' && gP.honoraires_comptables === 25000 && gP.regle_proportionnelle === 90);

  // Questions sectorielles, assurés additionnels, flottante
  r = await req(jar, 'POST', `/combinees/${dossierId}/questions`, {
    form: { _csrf: jetonFiche, q_entr_licence_rbq: 'RBQ 1234-5678-01', q_copro_ascenseur: 'Non applicable' },
  });
  test('questions sectorielles → 302', r.statut === 302, String(r.statut));
  const rep = bd.prepare('SELECT * FROM client_questions_sectorielles WHERE client_id = ? AND code_question = ?').get(clientId, 'entr_licence_rbq');
  test('réponse sectorielle relue', rep && rep.reponse === 'RBQ 1234-5678-01');
  r = await req(jar, 'POST', `/combinees/${dossierId}/assures`, {
    form: { _csrf: jetonFiche, nom: 'Banque Exemple', interet: 'Créancier' },
  });
  const aa = bd.prepare("SELECT * FROM soumission_assures_additionnels WHERE dossier_type = 'combine' AND dossier_id = ?").get(dossierId);
  test('assuré additionnel du dossier relu', r.statut === 302 && aa && aa.nom === 'Banque Exemple');
  r = await req(jar, 'POST', `/combinees/${dossierId}/flottante`, {
    form: { _csrf: jetonFiche, description: 'Outils de joaillerie', montant: '25000' },
  });
  const fl = bd.prepare('SELECT * FROM biens_flottante_articles WHERE soumission_id = ?').get(idParProduit.biens);
  test('article de flottante relu', r.statut === 302 && fl && fl.montant === 25000);

  // Contrôle serveur : lier une soumission d'un AUTRE client doit échouer
  const client2 = bd.prepare(
    "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom) VALUES (?, 'Autre Entreprise', 'A', 'B')"
  ).run(cabinet.id).lastInsertRowid;
  const sAutre = bd.prepare(
    'INSERT INTO biens_soumissions (cabinet_id, client_id, cree_par) VALUES (?, ?, ?)'
  ).run(cabinet.id, client2, 1).lastInsertRowid;
  let rejete = false;
  try {
    combine.creerDossier({
      cabinetId: cabinet.id, userId: 1, clientId,
      donnees: { lier: { biens: sAutre } },
    });
  } catch (e) { rejete = /n\u2019appartient pas/.test(e.message); }
  test('contrôle serveur : liaison croisée entre clients rejetée', rejete);

  // Archivage doux du dossier
  const d2 = combine.creerDossier({ cabinetId: cabinet.id, userId: 1, clientId });
  combine.archiverDossier(d2, cabinet.id, 1);
  test('archivage doux : le dossier disparaît de la liste mais reste en base',
    !combine.listerDossiers(cabinet.id).some((x) => x.id === d2)
    && bd.prepare('SELECT archive FROM combine_dossiers WHERE id = ?').get(d2).archive === 1);

  console.log(`\n${total - echecs}/${total} tests réussis`);
  if (echecs) { console.log(`💥 ${echecs} échec(s)`); process.exit(1); }
  console.log('🎉 TOUS LES TESTS PASSENT');
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
