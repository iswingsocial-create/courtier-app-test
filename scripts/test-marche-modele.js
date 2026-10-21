/**
 * scripts/test-marche-modele.js — Mise en marché (F15), phase 1 : couche
 * modèle (lib/marche.js) — création d'envois (produit + combinée),
 * pré-remplissage du souscripteur depuis le contact « nouvelles
 * affaires » de l'assureur, brouillon courriel « demande de prix » et son
 * envoi SIMULÉ, transitions de statut guidées, questions, offre reçue,
 * refus motivé, relances, indicateurs, classement des réponses
 * d'assureurs (fil_marche) et commandes de l'assistant.
 * Suite MODÈLE : aucun serveur. Base FRAÎCHE via CHEMIN_BD.
 * Usage : CHEMIN_BD=/tmp/test-marche.db node scripts/test-marche-modele.js
 */
process.env.CHEMIN_BD = process.env.CHEMIN_BD || '/tmp/test-marche.db';
const bcrypt = require('bcrypt');
const bd = require('../lib/bd');
const marche = require('../lib/marche');
const biens = require('../lib/biens');
const combine = require('../lib/combine');
const classement = require('../lib/classement-courriels');
const commandes = require('../lib/commandes-ia');

let echecs = 0;
let total = 0;
function test(nom, condition, detail) {
  total++;
  if (condition) console.log(`  ✅ ${nom}`);
  else { console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); echecs++; }
}
async function testAsync(nom, promesse, verif) {
  total++;
  try {
    const r = await promesse;
    if (verif(r)) console.log(`  ✅ ${nom}`);
    else { console.log(`  ❌ ${nom}`); echecs++; }
  } catch (e) { console.log(`  ❌ ${nom} — exception : ${e.message}`); echecs++; }
}
function erreurDe(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}

(async () => {
console.log('== Mise en marché (F15) — modèle ==');

// --- Semis -------------------------------------------------------------------
const cab = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Marché').lastInsertRowid;
const cab2 = bd.prepare('INSERT INTO cabinets (nom) VALUES (?)').run('Cabinet Voisin').lastInsertRowid;
const hash = bcrypt.hashSync('Test1234!', 4);
const admin = bd.prepare(
  "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, 'admin@marche.ca', ?, 'admin', 'Admin Marché')"
).run(cab, hash).lastInsertRowid;
const admin2 = bd.prepare(
  "INSERT INTO users (cabinet_id, email, mot_de_passe_hash, role, nom) VALUES (?, 'admin@voisin.ca', ?, 'admin', 'Admin Voisin')"
).run(cab2, hash).lastInsertRowid;
const utilisateur = { id: admin, nom: 'Admin Marché' };
const client = bd.prepare(
  "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel, responsable_id) VALUES (?, 'Boulangerie Marché inc.', '', '', 'info@boulangerie.example', ?)"
).run(cab, admin).lastInsertRowid;
const client2 = bd.prepare(
  "INSERT INTO clients (cabinet_id, raison_sociale, prenom, nom, courriel) VALUES (?, 'Client Voisin inc.', '', '', 'info@voisin.example')"
).run(cab2).lastInsertRowid;
const assureur = bd.prepare(
  `INSERT INTO assureurs (cabinet_id, nom, na_nom, na_courriel, na_telephone, mod_nom, mod_courriel)
   VALUES (?, 'Assureur Alpha', 'Sophie Souscriptrice', 'sophie@alpha.example', '514-555-0101', 'Marc Avenants', 'marc@alpha.example')`
).run(cab).lastInsertRowid;

const sBiens = biens.creerSoumission({ cabinetId: cab, userId: admin, clientId: client });
biens.ajouterBatiment(sBiens, cab, admin, { adresse: '100 rue du Marché', ville: 'Laval' });

// --- 1. Schéma ------------------------------------------------------------------
console.log('1. Schéma');
const tables = bd.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
test('tables marche_envois / marche_evenements / marche_courriels créées',
  ['marche_envois', 'marche_evenements', 'marche_courriels'].every((t) => tables.includes(t)));
const colsCourriels = bd.prepare('PRAGMA table_info(courriels)').all().map((c) => c.name);
test('courriels.envoi_id présent', colsCourriels.includes('envoi_id'));

// --- 2. Résolution de cible -------------------------------------------------------
console.log('2. Cible');
const cible = marche.resoudreCible(cab, { produit: 'biens', soumissionId: sBiens });
test('cible produit résolue (client dénormalisé)', cible.clientId === client && cible.produit === 'biens');
test('cible d\u2019un autre cabinet refusée', !!erreurDe(() => marche.resoudreCible(cab2, { produit: 'biens', soumissionId: sBiens })));
test('produit inconnu refusé', !!erreurDe(() => marche.resoudreCible(cab, { produit: 'cargo', soumissionId: 1 })));

// --- 3. Création depuis l\u2019annuaire (pré-remplissage nouvelles affaires) -------------
console.log('3. Création — annuaire');
const avant = marche.sectionPourCible(cab, { produit: 'biens', soumissionId: sBiens });
test('section fiche : aucun envoi signalé avant création', avant.aucunEnvoi === true);
const { envoi: e1, brouillonId: b1 } = marche.creerEnvoi(cab, utilisateur, {
  produit: 'biens', soumissionId: sBiens, assureurId: assureur,
});
test('envoi créé en brouillon', e1.statut === 'brouillon');
test('marché repris de l\u2019annuaire', e1.marche_nom === 'Assureur Alpha');
test('souscripteur pré-rempli (contact nouvelles affaires)', e1.souscripteur_nom === 'Sophie Souscriptrice');
test('courriel du souscripteur pré-rempli', e1.souscripteur_courriel === 'sophie@alpha.example');
test('version de la proposition renseignée', !!e1.version_proposition);
test('documents par défaut déclarés', e1.documents.length >= 1);
test('client dénormalisé sur l\u2019envoi', e1.client_id === client);
const brouillon1 = marche.obtenirBrouillonCourriel(b1, cab);
test('brouillon « demande de prix » créé avec l\u2019envoi', !!brouillon1 && brouillon1.type === 'demande_prix' && brouillon1.statut === 'brouillon');
test('brouillon adressé au souscripteur', brouillon1.destinataire === 'sophie@alpha.example');
test('sujet du brouillon = demande de soumission', /Demande de soumission/.test(brouillon1.sujet));
test('événement de création au fil', marche.obtenirEnvoi(e1.id, cab).evenements.some((ev) => ev.type === 'creation'));
const journalCreation = bd.prepare("SELECT * FROM journal_audit WHERE cabinet_id = ? AND action = 'marche_envoi_cree'").get(cab);
test('journal d\u2019audit : marche_envoi_cree', !!journalCreation);
const apres = marche.sectionPourCible(cab, { produit: 'biens', soumissionId: sBiens });
test('section fiche : envoi listé après création', apres.aucunEnvoi === false && apres.envois.length === 1);

// --- 4. Création nom libre + erreurs -------------------------------------------------
console.log('4. Création — nom libre et erreurs');
const { envoi: e2 } = marche.creerEnvoi(cab, utilisateur, {
  produit: 'biens', soumissionId: sBiens, marcheNom: 'Grossiste Libre ltée',
  souscripteurNom: 'Guy Grossiste', souscripteurCourriel: 'guy@grossiste.example',
});
test('envoi hors annuaire créé (nom libre)', e2.marche_nom === 'Grossiste Libre ltée' && e2.assureur_id === null);
test('sans marché : refusé', !!erreurDe(() => marche.creerEnvoi(cab, utilisateur, { produit: 'biens', soumissionId: sBiens })));
test('assureur d\u2019un autre cabinet : refusé', !!erreurDe(() => marche.creerEnvoi(cab2, { id: admin2, nom: 'Admin Voisin' }, { produit: 'biens', soumissionId: sBiens, assureurId: assureur })));

// --- 5. Transmission par courriel (SIMULÉ) ------------------------------------------------
console.log('5. Envoi du courriel — mode simulé');
marche.majBrouillonCourriel(b1, cab, admin, {
  destinataire: 'sophie@alpha.example', sujet: brouillon1.sujet, corps: brouillon1.corps + '\nMerci.',
});
await testAsync('envoi du brouillon : mode simulé sans compte SMTP', marche.envoyerBrouillonCourriel(b1, cab, utilisateur),
  (r) => r.mode === 'simule');
const e1Envoye = marche.obtenirEnvoi(e1.id, cab);
test('envoi passé à « envoyé » après le courriel', e1Envoye.statut === 'envoye');
test('transmis_le renseigné', !!e1Envoye.transmis_le);
test('mode de transmission = courriel', e1Envoye.mode_transmission === 'courriel');
test('date de relance par défaut (+7 j)', e1Envoye.date_relance > new Date().toISOString().slice(0, 10));
test('message_id simulé conservé', /^simule-marche-/.test(marche.obtenirBrouillonCourriel(b1, cab).message_id || ''));
test('événement de transmission au fil', e1Envoye.evenements.some((ev) => ev.type === 'transmission'));
await testAsync('double envoi du même brouillon refusé', marche.envoyerBrouillonCourriel(b1, cab, utilisateur).then(() => 'ok', (e) => e.message),
  (r) => /déjà été envoyé/.test(String(r)));

// --- 6. Classement : réponse de l\u2019assureur au fil -------------------------------------------
console.log('6. Classement fil_marche');
const mid = marche.obtenirBrouillonCourriel(b1, cab).message_id;
const classementReponse = classement.classerCourriel(bd, cab, {
  sujet: 'Re: Demande de soumission', corpsTexte: 'Voici nos questions.',
  adressesExpediteur: ['sophie@alpha.example'], enReponseA: `<${mid}>`,
});
test('réponse au fil → client de l\u2019envoi', classementReponse.clientId === client);
test('réponse au fil → envoi rattaché', classementReponse.envoiId === e1.id);
test('méthode fil_marche', classementReponse.methode === 'fil_marche');
const classementAutreCab = classement.classerCourriel(bd, cab2, {
  sujet: 'Re: Demande', corpsTexte: '', adressesExpediteur: ['sophie@alpha.example'], enReponseA: `<${mid}>`,
});
test('fil d\u2019un autre cabinet : aucun rattachement', classementAutreCab.envoiId === null && classementAutreCab.clientId === null);

// --- 7. Transitions guidées ----------------------------------------------------------------------
console.log('7. Transitions');
test('brouillon → en_analyse direct refusé', !!erreurDe(() => marche.transitionner(e2.id, cab, utilisateur, 'en_analyse')));
const e2t = marche.marquerTransmis(e2.id, cab, utilisateur, {});
test('marquage manuel : envoyé + transmis_le + mode manuel', e2t.statut === 'envoye' && !!e2t.transmis_le && e2t.mode_transmission === 'manuel');
test('double marquage refusé', !!erreurDe(() => marche.marquerTransmis(e2.id, cab, utilisateur, {})));
const e2a = marche.transitionner(e2.id, cab, utilisateur, 'en_analyse');
test('envoyé → en analyse', e2a.statut === 'en_analyse');
const e2q = marche.enregistrerQuestions(e2.id, cab, utilisateur, {
  texteQuestions: 'Préciser le chiffre d\u2019affaires par activité.', responsable: 'client',
});
test('questions enregistrées : statut questions', e2q.statut === 'questions');
test('questions : texte + responsable conservés', /chiffre d\u2019affaires/.test(e2q.questions_en_attente) && e2q.questions_responsable === 'client');
test('questions vides refusées', !!erreurDe(() => marche.enregistrerQuestions(e2.id, cab, utilisateur, { texteQuestions: '  ' })));
const e2r = marche.questionsResolues(e2.id, cab, utilisateur);
test('questions résolues : retour en analyse, questions effacées', e2r.statut === 'en_analyse' && !e2r.questions_en_attente);

// --- 8. Offre reçue ----------------------------------------------------------------------------------
console.log('8. Offre');
test('offre sans prime refusée', !!erreurDe(() => marche.saisirOffre(e2.id, cab, utilisateur, { prime: '' })));
const e2o = marche.saisirOffre(e2.id, cab, utilisateur, {
  prime: '12 450,50', limites: 'Bâtiment 1 000 000 $, RC 2 000 000 $, franchise 2 500 $',
  conditions: 'Inspection requise avant émission', validite: '2026-11-30',
});
test('offre saisie : statut offre_recue', e2o.statut === 'offre_recue');
test('offre : prime convertie', Number(e2o.offre_prime) === 12450.50);
test('offre : limites / conditions / validité conservées',
  /franchise 2 500/.test(e2o.offre_limites) && /Inspection/.test(e2o.offre_conditions) && e2o.offre_validite === '2026-11-30');
test('événement offre au fil', e2o.evenements.some((ev) => ev.type === 'offre'));
const e2acc = marche.accepter(e2.id, cab, utilisateur);
test('offre acceptée : statut accepte', e2acc.statut === 'accepte');
test('envoi clos : modification refusée', !!erreurDe(() => marche.majEnvoi(e2.id, cab, utilisateur, { marcheNom: 'X' })));
test('envoi clos : transition refusée', !!erreurDe(() => marche.transitionner(e2.id, cab, utilisateur, 'annule')));

// --- 9. Refus motivé -------------------------------------------------------------------------------------
console.log('9. Refus');
const { envoi: e3 } = marche.creerEnvoi(cab, utilisateur, {
  produit: 'biens', soumissionId: sBiens, assureurId: assureur,
});
marche.marquerTransmis(e3.id, cab, utilisateur, {});
test('refus sans motif refusé', !!erreurDe(() => marche.enregistrerRefus(e3.id, cab, utilisateur, { motif: '' })));
const e3r = marche.enregistrerRefus(e3.id, cab, utilisateur, { motif: 'Risque hors appétit (bâtiment vacant)' });
test('refus enregistré : statut + motif', e3r.statut === 'refuse' && /hors appétit/.test(e3r.motif_refus));
test('événement refus au fil', e3r.evenements.some((ev) => ev.type === 'refus'));

// --- 10. Annulation -----------------------------------------------------------------------------------------
console.log('10. Annulation');
const { envoi: e4 } = marche.creerEnvoi(cab, utilisateur, {
  produit: 'biens', soumissionId: sBiens, marcheNom: 'Marché Annulé',
});
const e4a = marche.annuler(e4.id, cab, utilisateur, { motif: 'Client a choisi un autre courtier' });
test('annulation depuis brouillon : statut annule', e4a.statut === 'annule');
const toujoursLa = marche.obtenirEnvoi(e4.id, cab);
test('envoi annulé toujours présent au registre (jamais supprimé)', !!toujoursLa);

// --- 11. Relances ---------------------------------------------------------------------------------------------
console.log('11. Relances');
const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
bd.prepare('UPDATE marche_envois SET date_relance = ? WHERE id = ?').run(hier, e1.id);
const dues = marche.relancesDues(cab);
test('relance due détectée (envoyé + date échue)', dues.some((e) => e.id === e1.id));
test('offre reçue / acceptée jamais en relance due', !dues.some((e) => e.id === e2.id));
const bRelance = marche.preparerRelance(e1.id, cab, utilisateur);
const brouillonRelance = marche.obtenirBrouillonCourriel(bRelance, cab);
test('brouillon de relance préparé', !!brouillonRelance && brouillonRelance.type === 'relance' && brouillonRelance.statut === 'brouillon');
test('préparer deux fois : même brouillon ouvert réutilisé', marche.preparerRelance(e1.id, cab, utilisateur) === bRelance);
await testAsync('envoi de la relance (simulé)', marche.envoyerBrouillonCourriel(bRelance, cab, utilisateur), (r) => r.mode === 'simule');
const e1Relance = marche.obtenirEnvoi(e1.id, cab);
test('compteur de relances incrémenté', e1Relance.nb_relances === 1);
test('dernière relance horodatée', !!e1Relance.derniere_relance_le);
test('prochaine relance repoussée (+7 j)', e1Relance.date_relance > hier);
test('événement relance au fil', e1Relance.evenements.some((ev) => ev.type === 'relance'));
test('relance d\u2019un brouillon (non transmis) refusée', !!erreurDe(() => {
  const { envoi: eX } = marche.creerEnvoi(cab, utilisateur, { produit: 'biens', soumissionId: sBiens, marcheNom: 'Marché X' });
  marche.preparerRelance(eX.id, cab, utilisateur);
}));

// --- 12. Indicateurs et filtres ----------------------------------------------------------------------------------
console.log('12. Indicateurs / filtres');
const ind = marche.indicateurs(cab);
test('indicateurs : offres reçues comptées (acceptée incluse au registre)', ind.total >= 5);
test('indicateurs : refus compté', ind.refus === 1);
test('filtre par statut', marche.listerEnvois(cab, { statut: 'refuse' }).every((e) => e.statut === 'refuse'));
test('filtre par client', marche.listerEnvois(cab, { clientId: client }).every((e) => e.client_id === client));
test('filtre par assureur (annuaire)', marche.listerEnvois(cab, { assureurId: assureur }).every((e) => e.assureur_id === assureur));
test('cloisonnement : le cabinet voisin ne voit rien', marche.listerEnvois(cab2, {}).length === 0);

// --- 13. Dossier combiné --------------------------------------------------------------------------------------------
console.log('13. Combinée');
const dossierId = combine.creerDossier({ cabinetId: cab, userId: admin, clientId: client });
const { envoi: eComb } = marche.creerEnvoi(cab, utilisateur, {
  combineDossierId: dossierId, assureurId: assureur,
});
test('envoi combiné créé', eComb.produit === 'combinee' && eComb.combine_dossier_id === dossierId && eComb.client_id === client);
const sectionComb = marche.sectionPourCible(cab, { produit: 'combinee', combineDossierId: dossierId });
test('section fiche combinée : envoi listé', sectionComb.envois.length === 1 && sectionComb.aucunEnvoi === false);
const cibleComb = marche.resoudreCible(cab, { combineDossierId: dossierId });
test('cible combinée : même client contrôlé côté serveur', cibleComb.clientId === client);
test('combinée d\u2019un autre cabinet refusée', !!erreurDe(() => marche.resoudreCible(cab, { combineDossierId: 99999 })));

// --- 14. Commandes de l\u2019assistant --------------------------------------------------------------------------------------
console.log('14. Commandes IA');
const cmdOuvrir = commandes.analyser('ouvre la mise en marché de Boulangerie Marché');
test('commande « ouvre la mise en marché de X » reconnue', !!cmdOuvrir && cmdOuvrir.action === 'ouvrir_mise_en_marche');
const rOuvrir = commandes.executerCommande(cab, utilisateur, cmdOuvrir);
test('exécution : redirection vers le registre filtré du client',
  rOuvrir.statut === 'redirection' && /client_id=/.test(rOuvrir.url || ''), JSON.stringify(rOuvrir));
const cmdRelances = commandes.analyser('relances de mise en marché');
test('commande « relances de mise en marché » reconnue', !!cmdRelances && cmdRelances.action === 'relances_mise_en_marche');
bd.prepare('UPDATE marche_envois SET date_relance = ? WHERE id = ?').run(hier, e1.id);
const rRelances = commandes.executerCommande(cab, utilisateur, cmdRelances);
test('exécution relances : message listant la relance due',
  rRelances.statut === 'message' && /Assureur Alpha/.test(rRelances.texte || ''), rRelances.texte);
test('actions IA enregistrées (ACTIONS_COHERE)',
  commandes.ACTIONS_COHERE.includes('ouvrir_mise_en_marche') && commandes.ACTIONS_COHERE.includes('relances_mise_en_marche'));

console.log(`\n${total - echecs}/${total} tests réussis`);
if (echecs) { console.log(`❌ ${echecs} échec(s)`); process.exit(1); }
console.log('TOUS LES TESTS PASSENT');
})();
