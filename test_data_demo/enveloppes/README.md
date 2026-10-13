# Jeu de démo — Enveloppes par CT (`demo_enveloppes.csv`)

Ce jeu sert à recetter les décisions n° 18, 19, 20 et 27 de `docs/DECISIONS.md` :
- une **enveloppe** = budget d'un CT sur sa propre période (date de début, date de fin, montant) ;
- le budget d'un CT est son enveloppe ; un CT sans enveloppe n'a pas de budget (« Sans enveloppe ») ;
- **sur-imputation** = statut dépassement (atterrissage > enveloppe) ;
- **sous-imputation** = sous-consommation à la date de fin (non consommé > 10 % **et** > 5 000 €) ;
- le PPS planifié hors période est affiché à part (« plan hors enveloppe »), comme le réalisé hors période (« réalisé hors enveloppe »).

Les enveloppes se **saisissent** dans l'interface (page Enveloppes), une par CT : `PUT /api/enveloppes/:ct` crée ou remplace l'enveloppe, `DELETE /api/enveloppes/:ct` la supprime (DECISIONS n° 27). L'import du fichier « CàT par CT » n'existe plus. La démo enregistre ses enveloppes par l'API, une requête `PUT` par ligne de CT de `demo_enveloppes.csv`.

Il s'appuie sur toute la démo : la timeline du plan de charge (`../timeline/`, étapes 1 à 6), le réalisé (`../demo_realise.xlsx`, as_of = 03/10/2026, S40) et les provisions (`../demo_provision.xlsx`). Les enveloppes s'enregistrent **après** ces imports, pour que la page Enveloppes et l'analyse croisent les CT des sources.

> **Confidentiel** : le vrai export (`../CàT par CT OCTOBRE V3.0_DEMO.xlsx`) n'a servi qu'à relever le format des anciennes données. Il ne doit **jamais** être commité (ni `git add -f`).

## Charger la démo

`seed_demo.sh` charge tout par l'API, dans l'ordre : les 6 versions du plan avec leur date d'effet, le réalisé, les provisions, puis les enveloppes (`PUT /api/enveloppes/:ct` avec le corps `{date_debut, date_fin, montant, categorie, operateur: "seed-demo"}`, un par CT du CSV). Il ne dépend que de `bash`, `awk`, `curl` et `python3`, et se lance depuis n'importe quel dossier.

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
- `--enveloppes-only` : n'enregistre que les enveloppes du CSV, sur une base où les autres imports sont déjà faits. Rejouable : chaque requête crée ou remplace l'enveloppe de son CT (sans changement, rien n'est journalisé) ; les enveloppes des CT absents du CSV sont conservées.
- `--help` : aide.

Le script refuse de tourner si la base contient déjà une version de plan : les dates d'effet de la timeline se mélangeraient aux versions existantes. Il marque une pause d'une seconde après chaque import de plan. L'heure d'import (`importee_le`, à la seconde près) départage en effet les versions : correctif n° 3 face à n° 2, « plan connu au ». Deux imports dans la même seconde seraient ordonnés au hasard. Compte une dizaine de secondes en tout. Il s'arrête au premier appel en erreur et affiche la réponse de l'API. Tous les imports et toutes les saisies sont signés `seed-demo`.

Attendu après le chargement :
- **Enveloppes** : `20 enveloppe(s) enregistrée(s)` (21 lignes de CT), une ligne ignorée : Y99F900016 « Ancien marché de prestations (A NE PAS UTILISER) », sans dates (« Période manquante ») ; ce CT n'existe dans aucune autre source de la démo. Σ des montants 1 182 000 €, période 01/01/2026 → 31/12/2027 ; le journal compte 20 `create` / `enveloppe` ;
- **Plan de charge** : 6 versions, la n° 6 (rétroactive, 24/08/2026) active, les 5 autres archivées, aucune purgée ;
- **Enveloppes** (page /enveloppes) : les 20 CT de la démo ont une enveloppe, groupés sous 7 catégories ; aucun « Hors catégorie » ni « Sans enveloppe » ;
- **Prévisions** : budget global = Σ des 20 enveloppes.

## Source : `demo_enveloppes.csv`

Une ligne par ligne de l'ancien export « CàT par CT » : `niveau;code;descriptif;date_debut;date_fin;prevision_solde;cout_encouru;cout_previsionnel`, UTF-8, séparateur `;`, en-tête en première ligne.
- `niveau` : 0 = catégorie (code finissant par `00`, sans dates), 1 = CT ; le `descriptif` d'une catégorie devient le libellé de catégorie (`categorie`) des CT qui la suivent ;
- dates `AAAA-MM-JJ` ;
- `cout_previsionnel` = **montant de l'enveloppe** ; `cout_encouru` = consommé réel du CT au 03/10/2026 (`previsions.par_ct[].consomme`) et `prevision_solde` sont informatifs, non envoyés.

Le script ignore, comme l'ancien import, les lignes de CT sans date de début ou de fin (« Période manquante »), avec fin avant début (« Fin avant début »), sans montant lisible ≥ 0 (« Montant invalide ») ou déjà vues (« CT en double ») ; un CT sans catégorie au-dessus est enregistré hors catégorie. Le libellé « à ne pas utiliser » n'est pas interprété. Les catégories saisies n'ont pas de code (`categorie = ''`), sauf si une enveloppe de même libellé en a hérité un de l'ancien import.

| Catégorie | Libellé | CT |
|---|---|---|
| Y99F91000 | Programme Démo — Plateforme | 90001, 90002, 90003, 90004 |
| Y99F92000 | Programme Démo — Data & IA | 90005, 90006, 90701 |
| Y99F93000 | Programme Démo — Pilotage & Transverse | 90007, 90008, 90009, 900010 |
| Y99F94000 | Programmes hors périmètre | 90601, 90602 |
| Y99F95000 | Réserve de capacité & aléas | 900011, 900012, 900015 |
| Y99F96000 | Prestations & achats hors programme | 900013, 900014, 900016 (ignoré) |
| Y99F97000 | Déplacements & missions | 900021, 900022 |

Les libellés de catégorie reprennent les groupes des provisions et du plan de la démo. Les codes de catégorie du CSV ne sont pas envoyés.

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

Si le réalisé ou la timeline changent, refais les calculs avec `GET /api/analyse`, puis ajuste les montants du CSV et lance `--enveloppes-only`.
