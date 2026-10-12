# Jeu de démo — Enveloppes par CT (`../demo_enveloppes.xlsx`)

Ce jeu sert à recetter les décisions n° 18 et n° 19 de `docs/DECISIONS.md` :
- une **enveloppe** = budget d'un CT sur sa propre période (date de début, date de fin, montant) ;
- pour un CT configuré, elle **remplace la charge max** (Σ PPS + provisions) comme budget ;
- **sur-imputation** = statut dépassement (atterrissage > enveloppe) ;
- **sous-imputation** = sous-consommation à la date de fin (non consommé > 10 % **et** > 5 000 €) ;
- le PPS planifié hors période est affiché à part (« plan hors enveloppe »), comme le réalisé hors période (« réalisé hors enveloppe »).

Les enveloppes ne se saisissent pas : elles sont **importées** depuis l'export xlsx « CàT par CT » (`POST /api/enveloppes/import`, aperçu par `POST /api/enveloppes/import/preview`). Chaque import remplace toutes les enveloppes. Le classeur de démo `../demo_enveloppes.xlsx` est généré à partir de `demo_enveloppes.csv` (voir plus bas).

Il s'appuie sur toute la démo : la timeline du plan de charge (`../timeline/`, étapes 1 à 6), le réalisé (`../demo_realise.xlsx`, as_of = 03/10/2026, S40) et les provisions (`../demo_provision.xlsx`). Les enveloppes s'importent **après** ces imports, pour que la page Enveloppes et l'analyse croisent les CT des sources.

> **Confidentiel** : le vrai export (`../CàT par CT OCTOBRE V3.0_DEMO.xlsx`) n'a servi qu'à relever le format. Il ne doit **jamais** être commité (ni `git add -f`). Seules ses parties sans données (styles, thème, relations, types : `gen/template/`) sont reprises ; aucun code, libellé ni montant.

## Charger la démo

`seed_demo.sh` charge tout par l'API, dans l'ordre : les 6 versions du plan avec leur date d'effet, le réalisé, les provisions, puis l'import de `../demo_enveloppes.xlsx` (un seul `curl -F file=@demo_enveloppes.xlsx -F importeur=seed-demo` vers `/api/enveloppes/import`). Il ne dépend que de `bash`, `curl` et `python3`, et se lance depuis n'importe quel dossier.

1. Démarre le backend sur une **base vide** :
   ```
   rm -f backend/data/njord.db*
   make dev-backend
   ```
   Pour garder ta base, lance plutôt le backend sur une autre : `cd backend && go run ./cmd/njord --db /tmp/njord-demo.db`.
2. Charge la démo :
   ```
   test_data_demo/enveloppes/seed_demo.sh
   ```

Options :
- `API=http://localhost:8091/api test_data_demo/enveloppes/seed_demo.sh` : autre adresse (défaut `http://localhost:8080/api`).
- `--enveloppes-only` : ne fait que l'import de `../demo_enveloppes.xlsx`, sur une base où les autres imports sont déjà faits. Rejouable : chaque import remplace toutes les enveloppes.
- `--help` : aide.

Le script refuse de tourner si la base contient déjà une version de plan : les dates d'effet de la timeline se mélangeraient aux versions existantes. Il marque une pause d'une seconde après chaque import de plan. L'heure d'import (`importee_le`, à la seconde près) départage en effet les versions : correctif n° 3 face à n° 2, « plan connu au ». Deux imports dans la même seconde seraient ordonnés au hasard. Compte une dizaine de secondes en tout. Il s'arrête au premier appel en erreur et affiche la réponse de l'API. Tous les imports sont signés `seed-demo` (importeur).

Attendu après le chargement :
- **Import des enveloppes** : `20 ok, 0 warn, 1 drop ; 1 × Période manquante` (21 lignes de CT). Le drop est Y99F900016 « Ancien marché de prestations (A NE PAS UTILISER) », sans dates : ce CT n'existe dans aucune autre source de la démo. Σ des montants acceptés 1 182 000 €, période 01/01/2026 → 31/12/2027 ;
- **Plan de charge** : 6 versions, la n° 6 (rétroactive, 24/08/2026) active, les 5 autres archivées, aucune purgée ;
- **Enveloppes** (page /enveloppes) : les 20 CT de la démo ont une enveloppe, groupés sous 7 catégories ; aucun « Hors catégorie » ni « Hors fichier » ;
- **Prévisions** : budget global de source `enveloppe`.

## Format « CàT par CT » (`../demo_enveloppes.xlsx`)

`../demo_enveloppes.xlsx` reproduit **au texte près** l'export Planisware réel (DECISIONS n° 18). Le générateur n'utilise pas de bibliothèque xlsx : il écrit lui-même chaque partie du classeur.
- **Archive** : les 12 parties de l'export, dans son ordre (`customXml/…`, `_rels/.rels`, `docProps/core.xml`, `xl/…`, `[Content_Types].xml` en dernier), Deflate, en-têtes zip version 2.0 sans descripteur ni extra. Pas de `docProps/app.xml`.
- **Feuille** « Activité sans archive » : `dimension` A1:I10 (fixe, comme l'export), volet figé sous la ligne 3, largeurs de colonnes, styles `s=1…10` et espaces des cellules de l'export, balise `<pargeMargins>` (sic) comprise.
- **Ligne 1** : `A1` date d'extraction **en texte** `jj/mm/aa` (05/10/26), `D1` « Tableau », `G1` « Utilisateur demo.njord » (fusions A1:C1, D1:F1, G1:I1). Pas de ligne 2.
- **Ligne 3**, en-tête : `Nom | Descriptif | Calendrier | Date de début Contrôles de mouvement | Date de fin Contrôles de mouvement | Prévision pour solde | Coût encouru | Coût prévisionnel | Bloc note`.
- **Ligne de catégorie** (niveau de plan 0, styles 3-6) : code finissant par `00`, sans dates, F/G/H = Σ de ses CT.
- **Ligne de CT** (niveau de plan 1, styles 7-10) : code (style 10 si le CT est daté, 7 sinon), libellé, dates en numéros de série (`dd/mm/y`), montants au format `#,##0 "_EURO"`. **G = Coût encouru** = consommé réel du CT au 03/10/2026 (`previsions.par_ct[].consomme`), **H = Coût prévisionnel = montant de l'enveloppe**, F = Prévision pour solde = max(H − G, 0). Calendrier et Bloc note vides.
- **Noms définis** : `opx_version`, un `EXID…_0` par ligne de données, `NO_IMPORT1`, `ATT_NAME` … `ATT_NOTE_PAD`, `NO_IMPORT2`, `_xlnm.Print_Titles`. Les EXID, le `ts` de `customXml/item1.xml` et le GUID de `itemProps1.xml` sont dérivés du contenu (sha256) : une régénération donne le même fichier.

Njord ne lit que `Nom`, `Descriptif`, les deux dates et `Coût prévisionnel`.

**Contrôle de fidélité** : le générateur, nourri des valeurs du vrai export (CSV temporaire hors dépôt), le reproduit à l'identique. Seuls diffèrent les identifiants dérivés (EXID, `ts`, GUID) et le style du code d'un CT non daté que l'export marque pourtant comme ouvert (style 10) : le générateur déduit ce style des dates.

| Catégorie | Libellé | CT |
|---|---|---|
| Y99F91000 | Programme Démo — Plateforme | 90001, 90002, 90003, 90004 |
| Y99F92000 | Programme Démo — Data & IA | 90005, 90006, 90701 |
| Y99F93000 | Programme Démo — Pilotage & Transverse | 90007, 90008, 90009, 900010 |
| Y99F94000 | Programmes hors périmètre | 90601, 90602 |
| Y99F95000 | Réserve de capacité & aléas | 900011, 900012, 900015 |
| Y99F96000 | Prestations & achats hors programme | 900013, 900014, 900016 (drop) |
| Y99F97000 | Déplacements & missions | 900021, 900022 |

Les libellés de catégorie reprennent les groupes des provisions et du plan de la démo. Leurs codes ne recoupent aucun CT des fichiers de démo (Y99F90000 et Y99F90100…90600 y sont déjà pris).

## Source et générateur

`demo_enveloppes.csv`, une ligne par ligne de la feuille : `niveau;code;descriptif;date_debut;date_fin;prevision_solde;cout_encouru;cout_previsionnel`, UTF-8, séparateur `;`.
- `niveau` : 0 = catégorie, 1 = CT ; une catégorie s'applique aux CT qui la suivent ;
- dates `AAAA-MM-JJ`, vides = ligne sans période ;
- montants en euros, recopiés tels quels dans le classeur ; vides : catégorie = Σ de ses CT, CT : G = 0 et F = max(H − G, 0).

Pour régénérer `../demo_enveloppes.xlsx` après une modification du CSV (bibliothèque standard Go seule) :
```
cd backend && go run ../test_data_demo/enveloppes/gen/main.go
```
Options : `-csv` (source), `-out` (classeur écrit), `-date` (date d'extraction, défaut `05/10/26`) et `-user` (login, défaut `demo.njord`). Par défaut, le CSV est lu dans `test_data_demo/enveloppes/` et le classeur écrit dans `test_data_demo/demo_enveloppes.xlsx`, à côté des autres fichiers de démo.

## Scénarios

Chiffres relevés sur l'API réelle (moteur des décisions n° 18 et 19), as_of = 03/10/2026. AP = atterrissage plan, AT = atterrissage tendance, NC = non consommé à la date de fin. Pour une enveloppe 2026, la période va de S01 à S53 (28/12/2026 → 03/01/2027) : le PPS planifié en 2027 est hors enveloppe.

| CT | Libellé | Période | Enveloppe | Démontre | Statut attendu |
|---|---|---|---:|---|---|
| Y99F90008 | Comité d'Architecture | 2026 | 50 000 € | **Sur-imputation** : AP 60 023 € | dépassement |
| Y99F90602 | Support exploitation 24/7 | 2026 | 38 000 € | **Sur-imputation** (AP 53 951 €) et 34 374 € de plan 2027 hors enveloppe | dépassement |
| Y99F900011 | Réserve de capacité Site Loire | 2026 | 200 000 € | **Sur-imputation** : AP 219 676 €, tendance 387 495 € | dépassement |
| Y99F900014 | Achats non stockables | 2026 | 0 € | Enveloppe nulle mais 368 € consommés | dépassement |
| Y99F90001 | Alpha Core Team | 2026 | 108 000 € | AP 99 494 € dans les 95 %, mais tendance à 122 109 € ; NC 8 506 € (7,9 %) sous le seuil | vigilance |
| Y99F900010 | Recette & amélioration continue | 2026 | 30 000 € | AP 28 288 € au-delà de 95 %, tendance 38 800 € ; NC 1 712 € | vigilance |
| Y99F900022 | Missions Sprint Planning | 2026 | 20 000 € | CT seulement dans le réalisé et les provisions : 18 429 € consommés, tendance 68 094 € | vigilance |
| Y99F900012 | Provisions pour aléas | 2026 | 79 000 € | AP 76 434 € au-delà de 95 %, **et** tendance (59 913 €) très en dessous : NC 19 087 €. Un CT peut être à la fois en vigilance et en sous-consommation. Les 100 000 € de provisions ne comptent pas (marge) | vigilance + sous-conso |
| Y99F90004 | Squad UI Experience | 2026 | 70 000 € | Plan tenu (AP 55 442 €) mais tendance à 120 405 € ; NC 14 558 € | vigilance + sous-conso |
| Y99F90009 | Cellule Transverse Qualité | 2026 | 80 000 € | AP 68 330 €, tendance 122 445 € ; NC 11 670 € | vigilance + sous-conso |
| Y99F900013 | Prestations externes | 2026 | 30 000 € | Pas de plan : AP = consommé (11 428 €), tendance 44 848 € ; NC 18 572 € | vigilance + sous-conso |
| Y99F90601 | Squad Académie & Montée en compétence | 2026 | 31 000 € | **Conforme** : AP 27 045 €, AT 29 052 €, NC 3 955 € (< 5 000 €) | ok |
| Y99F90701 | Pilote IA générative | 01/01 → 31/03/2027 | 4 000 € | Enveloppe **future** : rien de consommé, AP 3 437 € (PETIT Karim à 20 % à partir du 04/01/2027). La S53 de 2026 fait partie de la période | ok |
| Y99F90006 | Squad Development Experience | 2026 | 130 000 € | **Sous-imputation** : AP 99 474 €, AT 84 799 €, NC 45 201 € | ok + sous-conso |
| Y99F90003 | Data Stack - management de la donnée | 2026 | 100 000 € | **Sous-imputation** : AP 78 608 €, AT 65 922 €, NC 34 078 € | ok + sous-conso |
| Y99F90005 | Engineering Experience | 2026 | 60 000 € | **Sous-imputation** : AP 35 520 €, AT 49 456 €, NC 24 480 € | ok + sous-conso |
| Y99F900021 | Missions PI Planning | 2026 | 25 000 € | Pas de plan : 6 400 € consommés, NC 18 600 € | ok + sous-conso |
| Y99F90007 | Intégration système & MBSE | 01/09 → 30/11/2026 | 72 000 € | Période qui **finit avant le plan** : AP 64 772 € et 20 624 € de PPS (décembre et 2027) hors enveloppe. La fin, un lundi, inclut toute la S49. Tendance basse (33 728 €) : NC 38 272 € | ok + sous-conso |
| Y99F90002 | Platform Cloud | 01/01 → 30/09/2026 | 15 000 € | Enveloppe **terminée** : les 859 € imputés par BONNET les 01–02/10 sont du réalisé hors enveloppe ; consommé 6 875 €, le reste (8 125 €) est perdu | ok + sous-conso |
| Y99F900015 | Fonds de transformation | 2027 | 40 000 € | CT présent **seulement dans les provisions** : aucun plan, donc toute l'enveloppe est non consommée | ok + sous-conso |

Synthèse `previsions.enveloppes` attendue : 20 CT configurés sur 20, Σ enveloppes 1 182 000 €, 4 dépassements (46 017 €), 11 sous-consommations (294 987 € non consommés), 242 639 € de plan hors enveloppe. La timeline compte 123 segments pour Σ PPS = 1 181 434,37 €, comme l'étape 6 de `../timeline/`.

### Pourquoi ces montants

Pour une enveloppe 2026 commencée avant le réalisé, AP et AT sont la `projection_plan_echeance` et la `projection_tendance_echeance` au 31/12/2026. Le statut et la sous-consommation en découlent :
- dépassement si AP > enveloppe ;
- vigilance si AT > enveloppe ou AP > 95 % ;
- sous-consommation si l'enveloppe moins la plus basse des deux projections dépasse 10 % **et** 5 000 €.

Pour être **ok sans sous-consommation**, il faut donc AP ≤ 95 % de l'enveloppe, AT ≤ enveloppe et un écart à la plus basse projection ≤ 10 % ou ≤ 5 000 €.

Sur 2026, Alpha Core Team (90001) et Provisions pour aléas (90012) ne peuvent pas l'être : leur tendance s'écarte de plus de 10 % du plan (au-dessus pour 90001, en dessous pour 90012). Le cas conforme est donc porté par 90601.

Si le réalisé ou la timeline changent, refais les calculs avec `GET /api/analyse`, puis ajuste les montants du CSV, régénère `../demo_enveloppes.xlsx` et lance `--enveloppes-only`.
