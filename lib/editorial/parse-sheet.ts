/**
 * Lecture du tableau de production éditoriale maintenu à la main dans Google Sheets.
 *
 * Le tableau n'est pas une liste d'articles : c'est une MATRICE. Deux blocs :
 *
 *  A. Production hebdomadaire — lignes = (personne, destination), colonnes = semaines,
 *     chaque semaine portant deux sous-colonnes « New » et « MAJ ». Les cellules sont
 *     des compteurs d'articles, parfois annotés en clair.
 *
 *  B. Stock d'articles — par destination, en photo à chaque fin de mois : nombre
 *     d'articles publiés et nombre restant à mettre à jour. C'est le dénominateur :
 *     5 nouveaux articles sur un site qui en compte 80 n'est pas 5 sur un site qui en
 *     compte 350.
 *
 * Le tableau étant tenu à la main, tout est repéré par le CONTENU (« Quoi », « Où »,
 * « New », « MAJ », « ACTUEL »), jamais par un numéro de ligne ou de colonne, et tout
 * ce qui n'est pas compris est remonté dans `anomalies` — un import silencieusement
 * vide serait indiscernable d'une semaine sans production.
 */

const MOIS_FR: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fevr: 2, fev: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, aou: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
}

const iso = (annee: number, mois: number, jour: number) =>
  `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;

/* ───────────────────────────── Libellés de semaine ─────────────────────────── */

interface BornesSemaine {
  jourDebut: number;
  moisDebut: number;
  jourFin: number;
  moisFin: number;
}

/**
 * « 4-8 mai », « 29 juin - 5 juil », « 27 juil- 2 aout », « 1 mai ».
 * Le mois peut manquer à gauche : il est alors repris de la droite.
 */
export function parseLibelleSemaine(libelle: string): BornesSemaine | null {
  const parts = libelle.split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;

  const morceau = (txt: string): { jour: number | null; mois: number | null } => {
    const m = normalise(txt).match(/^(\d{1,2})?\s*([a-z]+)?$/);
    if (!m) return { jour: null, mois: null };
    return {
      jour: m[1] ? Number(m[1]) : null,
      mois: m[2] ? (MOIS_FR[m[2]] ?? null) : null,
    };
  };

  const gauche = morceau(parts[0]);
  const droite = parts.length === 2 ? morceau(parts[1]) : gauche;

  const moisFin = droite.mois ?? gauche.mois;
  const moisDebut = gauche.mois ?? moisFin;
  if (gauche.jour === null || droite.jour === null || moisDebut === null || moisFin === null) {
    return null;
  }
  return { jourDebut: gauche.jour, moisDebut, jourFin: droite.jour, moisFin };
}

export interface SemaineColonnes {
  libelle: string;
  debut: string;
  fin: string;
  colNouveaux: number;
  colMajs: number;
}

/**
 * Le tableau ne porte aucune année. On la déduit : les mois avancent de gauche à
 * droite, donc un mois qui recule signale un passage d'année ; puis l'ensemble est
 * décalé pour que la dernière semaine tombe au plus près d'aujourd'hui.
 */
function attribuerAnnees(bornes: BornesSemaine[], aujourdhui: string): number[] {
  const anneeRef = Number(aujourdhui.slice(0, 4));
  const decalages: number[] = [];
  let courant = 0;
  for (let i = 0; i < bornes.length; i++) {
    if (i > 0 && bornes[i].moisDebut < bornes[i - 1].moisDebut) courant++;
    decalages.push(courant);
  }

  const finDe = (base: number) => {
    const d = bornes[bornes.length - 1];
    return new Date(`${iso(base + decalages[decalages.length - 1], d.moisFin, d.jourFin)}T12:00:00Z`).getTime();
  };
  const cible = new Date(`${aujourdhui}T12:00:00Z`).getTime();
  const base = [anneeRef - 1, anneeRef, anneeRef + 1].reduce((meilleur, candidat) =>
    Math.abs(finDe(candidat) - cible) < Math.abs(finDe(meilleur) - cible) ? candidat : meilleur,
  );

  return decalages.map((d) => base + d);
}

/* ─────────────────────────────── Cellules ──────────────────────────────────── */

export interface Cellule {
  valeur: number | null;
  note: string | null;
}

/**
 * Une cellule vide ou « / » n'est PAS un zéro : c'est une absence de saisie, et la
 * confondre avec zéro ferait apparaître des creux de production qui n'existent pas.
 * Un nombre suivi de texte (« 2 (quand partir + MAJ météo) ») garde les deux.
 */
export function parseCellule(brut: string | undefined): Cellule {
  const txt = (brut ?? '').trim();
  if (!txt || txt === '/' || normalise(txt) === 'na' || normalise(txt) === 'n/a') {
    return { valeur: null, note: null };
  }
  const m = txt.match(/^(\d+)\s*([\s\S]*)$/);
  if (m) {
    const reste = m[2].trim();
    return { valeur: Number(m[1]), note: reste ? reste : null };
  }
  return { valeur: null, note: txt };
}

/* ──────────────────────────── Résultat du parsing ──────────────────────────── */

export interface LigneActivite {
  personne: string | null;
  objectif: string | null;
  destination: string;
  semaines: Array<{
    debut: string;
    fin: string;
    nouveaux: number | null;
    majs: number | null;
    notes: string[];
  }>;
}

export interface LigneStock {
  destination: string;
  photos: Array<{ libelle: string; date: string | null; publies: number | null; resteAMaj: number | null }>;
}

export interface TableauEditorial {
  semaines: SemaineColonnes[];
  activite: LigneActivite[];
  stock: LigneStock[];
  anomalies: string[];
}

const cel = (ligne: string[], i: number) => (ligne[i] ?? '').trim();

export function parseTableauEditorial(
  lignes: string[][],
  opts: { aujourdhui: string },
): TableauEditorial {
  const anomalies: string[] = [];

  /* ── Bloc A : repérage de l'en-tête ─────────────────────────────────────── */
  const iEntete = lignes.findIndex(
    (l) => l.some((c) => normalise(c) === 'quoi') && l.some((c) => normalise(c) === 'ou'),
  );
  if (iEntete === -1) {
    return {
      semaines: [], activite: [], stock: [],
      anomalies: ['En-tête introuvable : aucune ligne ne contient à la fois « Quoi » et « Où ». Structure du tableau modifiée ?'],
    };
  }

  const entete = lignes[iEntete];
  const colQuoi = entete.findIndex((c) => normalise(c) === 'quoi');
  const colOu = entete.findIndex((c) => normalise(c) === 'ou');
  const iSous = iEntete + 1;
  const sousEntete = lignes[iSous] ?? [];

  /* ── Bloc A : colonnes de semaines ──────────────────────────────────────── */
  const brutes: Array<{ libelle: string; bornes: BornesSemaine; colNouveaux: number; colMajs: number }> = [];
  for (let c = colOu + 1; c < entete.length; c++) {
    const libelle = cel(entete, c);
    if (!libelle) continue;

    const bornes = parseLibelleSemaine(libelle);
    if (!bornes) {
      anomalies.push(`Colonne « ${libelle} » : libellé de semaine non interprétable — colonne ignorée.`);
      continue;
    }
    // Une semaine doit porter ses deux sous-colonnes New / MAJ, dans cet ordre.
    if (normalise(cel(sousEntete, c)) !== 'new' || normalise(cel(sousEntete, c + 1)) !== 'maj') {
      anomalies.push(
        `Colonne « ${libelle} » sans le couple New/MAJ attendu juste en dessous — colonne ignorée.`,
      );
      continue;
    }
    brutes.push({ libelle, bornes, colNouveaux: c, colMajs: c + 1 });
  }

  const annees = attribuerAnnees(brutes.map((b) => b.bornes), opts.aujourdhui);
  const semaines: SemaineColonnes[] = brutes.map((b, i) => {
    // Une semaine à cheval sur deux mois se termine l'année suivante si le mois recule.
    const anneeFin = b.bornes.moisFin < b.bornes.moisDebut ? annees[i] + 1 : annees[i];
    return {
      libelle: b.libelle,
      debut: iso(annees[i], b.bornes.moisDebut, b.bornes.jourDebut),
      fin: iso(anneeFin, b.bornes.moisFin, b.bornes.jourFin),
      colNouveaux: b.colNouveaux,
      colMajs: b.colMajs,
    };
  });

  if (semaines.length === 0) {
    anomalies.push('Aucune colonne de semaine exploitable dans le bloc de production.');
  }

  /* ── Bloc A : lignes de données ─────────────────────────────────────────── */
  const activite: LigneActivite[] = [];
  let personneCourante: string | null = null;

  for (let i = iSous + 1; i < lignes.length; i++) {
    const ligne = lignes[i];
    const vide = ligne.every((c) => !c.trim());
    if (vide) break; // fin du bloc de production

    const destination = cel(ligne, colOu);
    // Les lignes de sous-total n'ont pas de destination : on les ignore plutôt que
    // de les additionner une deuxième fois.
    if (!destination) continue;

    const personne: string | null = cel(ligne, 0) || personneCourante;
    personneCourante = personne;

    const semainesLigne = semaines.map((s) => {
      const n = parseCellule(ligne[s.colNouveaux]);
      const m = parseCellule(ligne[s.colMajs]);
      const notes = [n.note, m.note].filter((x): x is string => Boolean(x));
      return { debut: s.debut, fin: s.fin, nouveaux: n.valeur, majs: m.valeur, notes };
    });

    activite.push({
      personne: personne || null,
      objectif: colQuoi >= 0 ? cel(ligne, colQuoi) || null : null,
      destination,
      semaines: semainesLigne,
    });
  }

  if (activite.length === 0) {
    anomalies.push('Aucune ligne de production lue sous l\'en-tête (colonne « Où » vide partout ?).');
  }

  /* ── Bloc B : stock d'articles ──────────────────────────────────────────── */
  const stock: LigneStock[] = [];
  const iActuel = lignes.findIndex((l) => l.some((c) => normalise(c) === 'actuel'));

  if (iActuel === -1) {
    anomalies.push('Bloc « stock d\'articles » introuvable (aucune ligne ne contient « ACTUEL ») — stock non importé.');
  } else {
    const ligneLibelles = lignes[iActuel];
    const lignePublies = lignes[iActuel + 1] ?? [];

    const photos: Array<{ libelle: string; date: string | null; col: number }> = [];
    for (let c = 0; c < ligneLibelles.length; c++) {
      const libelle = cel(ligneLibelles, c);
      if (!libelle) continue;
      if (normalise(cel(lignePublies, c)) !== 'publies') continue;

      let date: string | null = null;
      if (normalise(libelle) === 'actuel') {
        date = opts.aujourdhui;
      } else {
        const b = parseLibelleSemaine(libelle);
        if (b) {
          const annees2 = attribuerAnnees([b], opts.aujourdhui);
          date = iso(annees2[0], b.moisFin, b.jourFin);
        } else {
          anomalies.push(`Photo de stock « ${libelle} » : date non interprétable — colonne conservée sans date.`);
        }
      }
      photos.push({ libelle, date, col: c });
    }

    for (let i = iActuel + 2; i < lignes.length; i++) {
      const ligne = lignes[i];
      if (ligne.every((c) => !c.trim())) break;
      const destination = cel(ligne, 0);
      if (!destination) continue;
      if (normalise(destination) === 'faits') continue;

      stock.push({
        destination,
        photos: photos.map((p) => ({
          libelle: p.libelle,
          date: p.date,
          publies: parseCellule(ligne[p.col]).valeur,
          resteAMaj: parseCellule(ligne[p.col + 1]).valeur,
        })),
      });
    }

    if (stock.length === 0) {
      anomalies.push('Bloc « stock d\'articles » repéré mais aucune ligne de destination lue.');
    }
  }

  return { semaines, activite, stock, anomalies };
}

/** Découpage CSV minimal (guillemets, virgules et retours à la ligne échappés). */
export function parseCsv(texte: string): string[][] {
  const lignes: string[][] = [];
  let champ = '';
  let ligne: string[] = [];
  let dansGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; } else { dansGuillemets = false; }
      } else {
        champ += c;
      }
      continue;
    }
    if (c === '"') { dansGuillemets = true; continue; }
    if (c === ',') { ligne.push(champ); champ = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; continue; }
    champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}
