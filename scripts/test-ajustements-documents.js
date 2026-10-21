/**
 * scripts/test-ajustements-documents.js — Ajustements issus des documents
 * réels (directive du 2026-10-21) : souscription partagée (grossiste +
 * participants), financement de prime, certificats (attestation +
 * continuation de cautionnement), lignes de facture, avis à transmettre,
 * volet FPQ-4, exposition cyber, feuille de calcul PE, code interne.
 * Fonctions pures vérifiées en direct ; le reste par HTTP + lecture BD.
 * Prérequis : serveur sur PORT (défaut 3101), base FRAÎCHE (CHEMIN_BD).
 * Usage : PORT=3101 CHEMIN_BD=/tmp/x.db node scripts/test-ajustements-documents.js
 */
const path = require('path');

const BASE = `http://localhost:${process.env.PORT || 3101}`;
let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail !== undefined ? ' — ' + detail : ''}`); echecs++; }
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
  const texte = await res.text();
  return { statut: res.status, texte, location: res.headers.get('location') };
}
function csrf(texte) {
  const m = texte.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
async function connexion(jar, email, mdp) {
  const r = await req(jar, 'GET', '/connexion');
  return req(jar, 'POST', '/connexion', { form: { _csrf: csrf(r.texte), email, mot_de_passe: mdp } });
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function dansJours(n) { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); }

(async () => {
  console.log('== Tests ajustements documents réels :', BASE);

  // ---- 1. Fonctions pures -----------------------------------------------------
  console.log('1. Bibliothèque ajustements-documents');
  const ajust = require('../lib/ajustements-documents');
  // Paramètres du vrai calendrier Caron (Q.132894) : prime brute 2 758 $,
  // acompte 563,83 $, financé 2 194,17 $, taux 15,952 %, 11 × 215,73 $.
  const ech = ajust.genererEcheancier({
    taux_annuel: 15.952, nb_versements: 11, montant_finance: 2194.17,
    montant_versement: 215.73, premiere_date: '2025-11-07', date_debut: '2025-10-07',
  });
  test('échéancier : 11 versements', ech.length === 11, ech.length);
  test('échéancier : intérêts du 1er versement ≈ calendrier réel (29,72 $)',
    Math.abs(ech[0].interet - 29.72) <= 0.15, ech[0].interet);
  const totalInterets = ech.reduce((s, l) => s + l.interet, 0);
  test('échéancier : total des intérêts ≈ 178,86 $ (± 1,00 $)',
    Math.abs(totalInterets - 178.86) <= 1.0, totalInterets.toFixed(2));
  test('échéancier : solde final = 0', ech[ech.length - 1].solde === 0, ech[ech.length - 1].solde);
  const prochain = ajust.prochainPrelevement({
    montant_finance: 2194.17, nb_versements: 11, montant_versement: 215.73,
    premiere_date: '2025-11-07', versements_payes: [1, 2],
  }, '2025-12-20');
  test('prochain prélèvement : versement 3 au 2026-01-07',
    prochain && prochain.numero === 3 && prochain.date === '2026-01-07', JSON.stringify(prochain));
  test('tous versements payés → aucun prochain prélèvement',
    ajust.prochainPrelevement({ montant_finance: 100, nb_versements: 1, montant_versement: 100, premiere_date: '2025-11-07', versements_payes: [1] }, '2025-12-01') === null);
  const vOk = ajust.validerParticipants([
    { section: 'Biens', part_pct: 27 }, { section: 'Biens', part_pct: 23 },
    { section: 'Biens', part_pct: 12.5 }, { section: 'Biens', part_pct: 12.5 },
    { section: 'Biens', part_pct: 25 }, { section: 'Responsabilité', part_pct: 100 },
  ]);
  test('participants : sections à 100 % valides', vOk.valide === true, JSON.stringify(vOk.sections));
  const vKo = ajust.validerParticipants([{ section: 'Biens', part_pct: 60 }]);
  test('participants : section à 60 % signalée', vKo.valide === false && vKo.sections.Biens === 60);
  test('revenu d’entreprise F = A2 + B − ΣD',
    ajust.calculerRevenuEntreprise({ recettes_a2: 500000, autres_revenus_b: 10000, depenses_variables: [{ montant: 90000 }, { montant: 60000 }] }) === 360000);

  console.log('2. Extraction locale des participants (ancrage)');
  const moteur = require('../lib/analyse-document');
  const texteParticipants = [
    'Assureurs Participants',
    'Biens',
    "      Accelerant Compagnie d'Assurance du Canada en vertu du                   27,0 %     1 264 $                    ___________",
    '      contrat nº SOPLAICC0123',
    '      Echelon Assurance en vertu du contrat nº BAS002                          73,0 %     3 422 $                    ___________',
    '      Total (Biens)                                                           100,0 %     4 686 $',
    'Montant total de la prime                                                                 6 006 $',
  ].join('\n');
  const listes = moteur.extraireListes(texteParticipants, null);
  test('participants extraits même sans produit détecté', Array.isArray(listes.participants) && listes.participants.length === 2, JSON.stringify(listes.participants));
  test('participant 1 : nom, contrat (ligne suivante), part et prime',
    listes.participants[0].assureur_nom.includes('Accelerant') && listes.participants[0].numero_contrat === 'SOPLAICC0123'
    && listes.participants[0].part_pct === 27 && listes.participants[0].prime_part === 1264);
  test('la ligne Total n’est pas un participant', !listes.participants.some((p) => /total/i.test(p.assureur_nom)));
  const champsGrossiste = moteur.analyserLocal('Police émise par Echelon Assurance en vertu du contrat nº BAS002. Perception assuré.').champs;
  test('grossiste_contrat extrait de « en vertu du contrat nº »',
    champsGrossiste.some((c) => c.champ === 'entete.grossiste_contrat' && c.valeur === 'BAS002'));
  test('mode_facturation « perception assuré » détecté',
    champsGrossiste.some((c) => c.champ === 'entete.mode_facturation' && c.valeur === 'perception_assure'));

  // ---- 3. HTTP : entreprise + police en souscription partagée -------------------
  console.log('3. Registre de police : grossiste, participants, financement, attestation');
  const jar = nouveauJar();
  let r = await connexion(jar, 'admin@demo.ca', 'ChangeMoi123!');
  test('connexion admin démo', r.statut === 302, r.statut);

  const Bd = require('better-sqlite3');
  const bdRo = new Bd(process.env.CHEMIN_BD || path.join(__dirname, '..', 'courtier.db'), { readonly: true });

  r = await req(jar, 'GET', '/clients/nouveau');
  r = await req(jar, 'POST', '/clients', { form: {
    _csrf: csrf(r.texte), raison_sociale: 'Ajustements Documents inc.', prenom: 'A', nom: 'B', langue: 'FR',
    pays: 'Canada', telecopieur: '450-555-0101', numero_client_externe: 'CLI-EXT-99', fin_exercice_mois: '12',
  }});
  const idClient = Number((r.location || '').match(/\/clients\/(\d+)/)?.[1]);
  test('entreprise créée avec les nouveaux champs', r.statut === 302 && idClient > 0, `${r.statut} ${r.location}`);
  const clientDb = bdRo.prepare('SELECT * FROM clients WHERE id = ?').get(idClient);
  test('nº client externe, pays, télécopieur et fin d’exercice en base',
    clientDb.numero_client_externe === 'CLI-EXT-99' && clientDb.pays === 'Canada'
    && clientDb.telecopieur === '450-555-0101' && clientDb.fin_exercice_mois === 12);

  r = await req(jar, 'GET', '/assureurs/nouveau');
  r = await req(jar, 'POST', '/assureurs', { form: { _csrf: csrf(r.texte), nom: 'Assureur Registre Test' } });
  const idAssureur = Number((r.location || '').match(/\/assureurs\/(\d+)/)?.[1]);
  r = await req(jar, 'GET', '/polices/nouvelle');
  const jetonPolice = csrf(r.texte);
  r = await req(jar, 'POST', '/polices', { form: {
    _csrf: jetonPolice, client_id: idClient, ligne: 'biens', assureur_id: idAssureur,
    numero_police: 'SOP-TEST-001', date_effet: dansJours(-30), date_echeance: dansJours(335),
    franchise: '2500', statut: 'active', notes: '',
    grossiste_nom: 'Grossiste Test', grossiste_contrat: 'BAS002', mode_facturation: 'perception_assure',
    responsabilite_proportionnelle: 'on',
  }});
  const idPolice = Number((r.location || '').match(/\/police\/(\d+)/)?.[1]);
  test('police créée avec grossiste et facturation', r.statut === 302 && idPolice > 0, `${r.statut} ${r.location}`);
  const policeDb = bdRo.prepare('SELECT * FROM polices WHERE id = ?').get(idPolice);
  test('grossiste, contrat-cadre et mode de facturation en base',
    policeDb.grossiste_nom === 'Grossiste Test' && policeDb.grossiste_contrat === 'BAS002'
    && policeDb.mode_facturation === 'perception_assure' && policeDb.responsabilite_proportionnelle === 1);

  r = await req(jar, 'GET', '/polices/' + idPolice + '/registre');
  test('registre de police → 200 avec les sections', r.statut === 200 && /Assureurs participants/.test(r.texte) && /Financement de prime/.test(r.texte), r.statut);
  const jetonReg = csrf(r.texte);
  r = await req(jar, 'POST', '/polices/' + idPolice + '/participants', { form: {
    _csrf: jetonReg, section: 'Biens', assureur_nom: 'Assureur Alpha', numero_contrat: 'CT-A', part_pct: '60', prime_part: '2812',
  }});
  test('participant 60 % → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/polices/' + idPolice + '/registre');
  test('total de section incomplet signalé (60 %)', /Biens : 60 %/.test(r.texte));
  r = await req(jar, 'POST', '/polices/' + idPolice + '/participants', { form: {
    _csrf: csrf(r.texte), section: 'Biens', assureur_nom: 'Assureur Beta', numero_contrat: 'CT-B', part_pct: '40', prime_part: '1874',
  }});
  r = await req(jar, 'GET', '/polices/' + idPolice + '/registre');
  test('section complétée à 100 %', /Biens : 100 %/.test(r.texte) && /Assureur Beta/.test(r.texte));
  const participantsDb = bdRo.prepare('SELECT * FROM police_participants WHERE police_id = ? AND archive = 0').all(idPolice);
  test('2 participants en base', participantsDb.length === 2, participantsDb.length);

  r = await req(jar, 'POST', '/polices/' + idPolice + '/financement', { form: {
    _csrf: csrf(r.texte), numero_cotation: 'Q.TEST', organisme: 'Organisme Test', taux_annuel: '15.952',
    prime_brute: '2758', acompte: '563.83', nb_versements: '11', montant_versement: '215.73', premiere_date: dansJours(-20),
  }});
  test('financement enregistré → 302', r.statut === 302, r.statut);
  const finDb = bdRo.prepare('SELECT * FROM police_financements WHERE police_id = ?').get(idPolice);
  test('montant financé calculé (prime − acompte)', finDb && Math.abs(finDb.montant_finance - 2194.17) < 0.001, finDb && finDb.montant_finance);
  r = await req(jar, 'GET', '/polices/' + idPolice + '/registre');
  test('échéancier affiché (11 versements)', (r.texte.match(/financement\/paiement/g) || []).length === 11);
  r = await req(jar, 'POST', '/polices/' + idPolice + '/financement/paiement', { form: { _csrf: csrf(r.texte), numero: '1', paye: '1' } });
  const finDb2 = bdRo.prepare('SELECT * FROM police_financements WHERE police_id = ?').get(idPolice);
  test('versement 1 marqué payé', finDb2 && finDb2.versements_payes === '[1]', finDb2 && finDb2.versements_payes);

  r = await req(jar, 'GET', '/polices/' + idPolice + '/attestation-commerciale');
  test('attestation commerciale → 200', r.statut === 200 && /Attestation d’assurance commerciale/.test(r.texte), r.statut);
  r = await req(jar, 'POST', '/polices/' + idPolice + '/attestation-commerciale', { form: {
    _csrf: csrf(r.texte), destinataire: 'Banque Test', signataire_nom: 'Signataire Test', signataire_titre: 'Courtier', initiales: 'ST',
  }});
  test('attestation émise (page imprimable avec mentions légales)',
    r.statut === 200 && /Destinataire :<\/strong> Banque Test/.test(r.texte) && /ne confère aucun droit/.test(r.texte), r.statut);
  const certDb = bdRo.prepare('SELECT * FROM certificats_emis WHERE police_id = ?').all(idPolice);
  test('émission journalisée dans certificats_emis', certDb.length === 1 && certDb[0].destinataire === 'Banque Test');

  // ---- 4. Suivis sans faute : échéances ----------------------------------------
  console.log('4. Échéances : prélèvement à venir, certificat, avis non transmis');
  r = await req(jar, 'GET', '/echeances');
  test('tableau des échéances → 200', r.statut === 200, r.statut);
  test('prochain prélèvement visible aux échéances', /Prélèvements de financement à venir ou en retard/.test(r.texte) && /SOP-TEST-001/.test(r.texte));

  r = await req(jar, 'GET', '/clients/' + idClient);
  r = await req(jar, 'POST', '/clients/' + idClient + '/avis', { form: {
    _csrf: csrf(r.texte), emetteur: 'Grossiste Test', titre: 'Message important — Renouvellement', recu_le: dansJours(0),
  }});
  test('avis enregistré → 302', r.statut === 302, r.statut);
  r = await req(jar, 'GET', '/echeances');
  test('avis non transmis visible aux échéances', /Avis d’assureur reçus, à transmettre au client/.test(r.texte) && /Message important/.test(r.texte));
  const avisDb = bdRo.prepare('SELECT * FROM avis_transmissions WHERE client_id = ?').get(idClient);
  r = await req(jar, 'GET', '/clients/' + idClient);
  r = await req(jar, 'POST', `/clients/${idClient}/avis/${avisDb.id}/transmettre`, { form: { _csrf: csrf(r.texte), moyen: 'courriel' } });
  r = await req(jar, 'GET', '/echeances');
  test('avis transmis → retiré des échéances', !/Message important/.test(r.texte));

  // ---- 5. Cautionnement : certificat de continuation ---------------------------
  console.log('5. Certificat de continuation de cautionnement');
  r = await req(jar, 'GET', '/cautionnement/nouveau');
  r = await req(jar, 'POST', '/cautionnement', { form: { _csrf: csrf(r.texte), client_id: idClient } });
  const idCaut = Number((r.location || '').match(/\/cautionnement\/(\d+)/)?.[1]);
  test('soumission de cautionnement créée', r.statut === 302 && idCaut > 0, `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/cautionnement/' + idCaut);
  r = await req(jar, 'POST', '/cautionnement/' + idCaut + '/certificats', { form: {
    _csrf: csrf(r.texte), numero: '25-TEST-40', beneficiaire: 'Régie du bâtiment du Québec', montant: '40000',
    date_debut: dansJours(-335), date_fin: dansJours(30), mandataire_nom: 'Mandataire Test', mention_non_transmission: 'on',
  }});
  test('certificat de continuation enregistré → 302', r.statut === 302, r.statut);
  const certCaut = bdRo.prepare('SELECT * FROM caut_certificats WHERE soumission_id = ?').get(idCaut);
  test('certificat en base avec mention de non-transmission', !!certCaut && certCaut.mention_non_transmission === 1 && certCaut.montant === 40000);
  r = await req(jar, 'GET', '/cautionnement/certificats/' + certCaut.id + '/impression');
  test('certificat imprimable → 200', r.statut === 200 && /Certificat de continuation de cautionnement/.test(r.texte) && /ne doit pas être transmis au bénéficiaire/.test(r.texte), r.statut);
  r = await req(jar, 'GET', '/echeances');
  test('expiration du certificat visible aux échéances (≤ 90 j)', /Certificats de cautionnement à renouveler/.test(r.texte) && /25-TEST-40/.test(r.texte));

  // ---- 6. Facture à lignes -------------------------------------------------------
  console.log('6. Lignes de facture');
  r = await req(jar, 'GET', '/factures/nouvelle');
  r = await req(jar, 'POST', '/factures', { form: {
    _csrf: csrf(r.texte), client_id: idClient, police_id: idPolice, description: 'Police SOP-TEST-001',
    montant: '6546.54', date_emission: dansJours(0), date_echeance: dansJours(30),
  }});
  const idFacture = Number((r.location || '').match(/\/factures\/(\d+)/)?.[1]);
  test('facture créée', r.statut === 302 && idFacture > 0, `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/factures/' + idFacture);
  r = await req(jar, 'POST', '/factures/' + idFacture + '/lignes', { form: {
    _csrf: csrf(r.texte), type_transaction: 'prime', date_effet: dansJours(0), compagnie: 'Assureur Registre Test', description: 'Prime', montant: '6006',
  }});
  r = await req(jar, 'GET', '/factures/' + idFacture);
  r = await req(jar, 'POST', '/factures/' + idFacture + '/lignes', { form: {
    _csrf: csrf(r.texte), type_transaction: 'taxe', description: 'Taxe sur les primes', montant: '540.54',
  }});
  const factureDb = bdRo.prepare('SELECT * FROM factures WHERE id = ?').get(idFacture);
  test('total de la facture = somme des lignes', Math.abs(factureDb.montant - 6546.54) < 0.001, factureDb.montant);
  const lignesDb = bdRo.prepare('SELECT * FROM facture_lignes WHERE facture_id = ? AND archive = 0').all(idFacture);
  test('2 lignes en base', lignesDb.length === 2, lignesDb.length);

  // ---- 7. FPQ-4, cyber, PE -------------------------------------------------------
  console.log('7. Volet FPQ-4, exposition cyber, calcul PE');
  r = await req(jar, 'GET', '/auto/nouveau');
  r = await req(jar, 'POST', '/auto', { form: { _csrf: csrf(r.texte), client_id: idClient } });
  const idAuto = Number((r.location || '').match(/\/auto\/(\d+)/)?.[1]);
  test('soumission FPQ-1 créée', r.statut === 302 && idAuto > 0, `${r.statut} ${r.location}`);
  r = await req(jar, 'GET', '/auto/' + idAuto + '/fpq4');
  test('fiche FPQ-4 → 200', r.statut === 200 && /Volet FPQ-4/.test(r.texte), r.statut);
  r = await req(jar, 'POST', '/auto/' + idAuto + '/fpq4', { form: {
    _csrf: csrf(r.texte), garage_limite_rc: '2000000', garde_nb_vehicules_max: '25',
    terrain_terrain_cloture: 'on', employes_chauffeurs_remorqueurs: '4', avenant_4_70: 'on', prime_totale: '3200',
  }});
  const fpq4Db = bdRo.prepare('SELECT * FROM fpq4_fiches WHERE soumission_id = ?').get(idAuto);
  const fpq4Donnees = fpq4Db ? JSON.parse(fpq4Db.donnees_json) : {};
  test('fiche FPQ-4 en base (garage, garde, terrain, avenants)',
    fpq4Donnees.sections?.garage?.limite_rc === 2000000 && fpq4Donnees.sections?.garde?.nb_vehicules_max === 25
    && fpq4Donnees.sections?.terrain?.terrain_cloture === 1 && fpq4Donnees.avenants?.['4-70'] === 1, JSON.stringify(fpq4Donnees).slice(0, 160));
  r = await req(jar, 'GET', '/auto/' + idAuto);
  r = await req(jar, 'POST', '/auto/' + idAuto + '/mode-facturation', { form: { _csrf: csrf(r.texte), mode_facturation: 'agence' } });
  const autoDb = bdRo.prepare('SELECT * FROM auto_soumissions WHERE id = ?').get(idAuto);
  test('mode de facturation FPQ-1 en base', autoDb.mode_facturation === 'agence', autoDb.mode_facturation);

  r = await req(jar, 'GET', '/cyber/nouveau');
  r = await req(jar, 'POST', '/cyber', { form: { _csrf: csrf(r.texte), client_id: idClient } });
  const idCyber = Number((r.location || '').match(/\/cyber\/(\d+)/)?.[1]);
  r = await req(jar, 'GET', '/cyber/' + idCyber);
  r = await req(jar, 'POST', '/cyber/' + idCyber + '/exposition', { form: {
    _csrf: csrf(r.texte), nb_enregistrements: '250000', responsable_securite: 'Resp. Sécu',
    types_donnees: 'Données de paiement | 40000\nIdentifiants | 210000', normes: 'SOC 2\nISO 27001',
    revenus_territoires: 'Canada | 900000\nÉtats-Unis | 300000',
  }});
  test('exposition cyber → 302', r.statut === 302, r.statut);
  const cyberDb = bdRo.prepare('SELECT * FROM cyber_soumissions WHERE id = ?').get(idCyber);
  const typesDb = JSON.parse(cyberDb.types_donnees_json || '[]');
  test('exposition en base (enregistrements, types, revenus)',
    cyberDb.nb_enregistrements === 250000 && typesDb.length === 2 && typesDb[0].nombre === 40000
    && JSON.parse(cyberDb.revenus_territoires_json)[1].montant === 300000);

  r = await req(jar, 'GET', '/pe/nouveau');
  r = await req(jar, 'POST', '/pe', { form: { _csrf: csrf(r.texte), client_id: idClient } });
  const idPe = Number((r.location || '').match(/\/pe\/(\d+)/)?.[1]);
  r = await req(jar, 'GET', '/pe/' + idPe);
  r = await req(jar, 'POST', '/pe/' + idPe + '/calcul', { form: {
    _csrf: csrf(r.texte), recettes_a1: '520000', recettes_a2: '500000', autres_revenus_b: '10000',
    depenses_libelles: 'Achats\nLoyers variables', depenses_montants: '90000\n60000',
  }});
  const peDb = bdRo.prepare('SELECT * FROM pe_calculs WHERE soumission_id = ?').get(idPe);
  test('feuille de calcul PE : F calculé = 360 000 $', peDb && peDb.revenu_entreprise_f === 360000, peDb && peDb.revenu_entreprise_f);

  // ---- 8. Code interne utilisateur ----------------------------------------------
  console.log('8. Code interne (Admin)');
  const cabinetDb = bdRo.prepare('SELECT id FROM cabinets LIMIT 1').get();
  r = await req(jar, 'GET', '/admin/utilisateurs/nouveau');
  r = await req(jar, 'POST', '/admin/utilisateurs', { form: {
    _csrf: csrf(r.texte), nom: 'Courtier Code Interne', email: 'code-interne@test.ca',
    cabinet_id: cabinetDb.id, role: 'courtier', mot_de_passe: 'MotDePasseTest1!', code_interne: 'REP-99',
  }});
  const nouvelUser = bdRo.prepare("SELECT id, code_interne FROM users WHERE email = 'code-interne@test.ca'").get();
  test('code interne à la création', r.statut === 302 && nouvelUser && nouvelUser.code_interne === 'REP-99', `${r.statut} ${nouvelUser && nouvelUser.code_interne}`);
  r = await req(jar, 'GET', '/admin/utilisateurs');
  r = await req(jar, 'POST', '/admin/utilisateurs/' + nouvelUser.id + '/code-interne', { form: { _csrf: csrf(r.texte), code_interne: 'REP-07' } });
  const userMaj = bdRo.prepare('SELECT code_interne FROM users WHERE id = ?').get(nouvelUser.id);
  test('code interne mis à jour', r.statut === 302 && userMaj.code_interne === 'REP-07', userMaj.code_interne);

  bdRo.close();
  console.log(`\n== Résultat : ${total - echecs}/${total} tests réussis`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error('Erreur fatale :', e); process.exit(1); });
