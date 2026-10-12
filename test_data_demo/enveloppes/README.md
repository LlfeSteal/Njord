# Jeu de démo — Enveloppes par CT (`demo_cat.xlsx`)

Ce jeu sert à recetter les décisions n° 18 et n° 19 de `docs/DECISIONS.md` :
- une **enveloppe** = budget d'un CT sur sa propre période (date de début, date de fin, montant) ;
- pour un CT configuré, elle **remplace la charge max** (Σ PPS + provisions) comme budget ;
- **sur-imputation** = statut dépassement (atterrissage > enveloppe) ;
- **sous-imputation** = sous-consommation à la date de fin (non consommé > 10 % **et** > 5 000 €) ;
- le PPS planifié hors période est affiché à part (« plan hors enveloppe »), comme le réalisé hors période (« réalisé hors enveloppe »).

Les enveloppes ne se saisissent pas : elles sont **importées** depuis l'export xlsx « CàT par CT » (`POST /api/enveloppes/import`, aperçu par `POST /api/enveloppes/import/preview`). Chaque import remplace toutes les enveloppes. Le classeur de démo `demo_cat.xlsx` est généré à partir de `demo_enveloppes.csv` (voir plus bas).

Il s'appuie sur toute la démo : la timeline du plan de charge (`../timeline/`, étapes 1 à 6), le réalisé (`../demo_realise.xlsx`, as_of = 03/10/2026, S40) et les provisions (`../demo_provision.xlsx`). Les enveloppes s'importent **après** ces imports, pour que la page Enveloppes et l'analyse croisent les CT des sources.

> **Confidentiel** : le vrai export (`../CàT par CT OCTOBRE V3.0_DEMO.xlsx`) n'a servi qu'à copier la mise en page. Il ne doit **jamais** être commité (ni `git add -f`). Aucun code, libellé ni montant n'en est repris ici.

## Charger la démo

`seed_demo.sh` charge tout par l'API, dans l'ordre : les 6 versions du plan avec leur date d'effet, le réalisé, les provisions, puis l'import de `demo_cat.xlsx` (un seul `curl -F file=@demo_cat.xlsx -F importeur=seed-demo` vers `/api/enveloppes/import`). Il ne dépend que de `bash`, `curl` et `python3`, et se lance depuis n'importe quel dossier.

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
- `--enveloppes-only` : ne fait que l'import de `demo_cat.xlsx`, sur une base où les autres imports sont déjà faits. Rejouable : chaque import remplace toutes les enveloppes.
- `--help` : aide.

Le script refuse de tourner si la base contient déjà une version de plan : les dates d'effet de la timeline se mélangeraient aux versions existantes. Il marque une pause d'une seconde après chaque import de plan. L'heure d'import (`importee_le`, à la seconde près) départage en effet les versions : correctif n° 3 face à n° 2, « plan connu au ». Deux imports dans la même seconde seraient ordonnés au hasard. Compte une dizaine de secondes en tout. Il s'arrête au premier appel en erreur et affiche la réponse de l'API. Tous les imports sont signés `seed-demo` (importeur).

Attendu après le chargement :
- **Import des enveloppes** : `12 ok, 0 warn, 1 drop ; 1 × Période manquante` (le drop est Y99F900013 « Prestations externes (A NE PAS UTILISER) », sans dates). Σ des montants acceptés 667 000 €, période 01/01/2026 → 31/12/2027 ;
- **Plan de charge** : 6 versions, la n° 6 (rétroactive, 24/08/2026) active, les 5 autres archivées, aucune purgée ;
- **Enveloppes** (page /enveloppes) : 20 CT, dont 12 avec enveloppe, groupés sous les 4 catégories, et 8 sans enveloppe (« Hors fichier », Y99F900013 compris puisque sa ligne est rejetée) ;
- **Prévisions** : budget global de source `mixte`.

## Format « CàT par CT » (`demo_cat.xlsx`)

Mise en page de l'export réel (DECISIONS n° 18) :
- une feuille « Activité sans archive » ;
- ligne 1 : `A1` date d'extraction **en texte** `jj/mm/aa`, `D1` « Tableau », `G1` « Utilisateur ext-demo.test » (fusions A1:C1, D1:F1, G1:I1) ; ligne 2 vide ;
- ligne 3, en-tête : `Nom | Descriptif | Calendrier | Date de début Contrôles de mouvement | Date de fin Contrôles de mouvement | Prévision pour solde | Coût encouru | Coût prévisionnel | Bloc note` (volets figés sous la ligne 3) ;
- **ligne de catégorie** : code finissant par `00`, en gras, sans dates, F/G/H = Σ de ses CT ;
- **ligne de CT** (niveau de plan 1) : code, libellé, dates en numéros de série Excel (format `dd/mm/y`), F = Prévision pour solde, G = Coût encouru (0 ici), H = Coût prévisionnel = **montant de l'enveloppe** (F = H − G).

Njord ne lit que `Nom`, `Descriptif`, les deux dates et `Coût prévisionnel`.

| Catégorie | Libellé | CT |
|---|---|---|
| Y99F91000 | Socle produit & plateforme (démo) | 90001, 90002, 90003, 90006 |
| Y99F92000 | Ingénierie & architecture (démo) | 90007, 90008, 90701 |
| Y99F93000 | Services transverses (démo) | 90601, 90602 |
| Y99F94000 | Réserves, achats & transformation (démo) | 900012, 900013 (drop), 900014, 900015 |

Les codes de catégorie ne recoupent aucun CT ni groupe des fichiers de démo (Y99F90000 et Y99F90100…90600 y sont déjà pris).

## Source et générateur

`demo_enveloppes.csv` : `categorie;categorie_libelle;ct;libelle;date_debut;date_fin;montant`, UTF-8, séparateur `;`, dates `AAAA-MM-JJ` (vides = ligne sans période), montant en euros. Les catégories sont écrites dans l'ordre de leur première apparition, leurs CT dans l'ordre du CSV.

Pour régénérer `demo_cat.xlsx` après une modification du CSV (excelize vient du module Go du backend) :
```
cd backend && go run ../test_data_demo/enveloppes/gen/main.go
```
Options : `-csv` (source) et `-out` (classeur écrit). Par défaut, les deux sont lus et écrits dans `test_data_demo/enveloppes/`.

## Scénarios

Chiffres relevés sur l'API réelle (moteur des décisions n° 18 et 19), as_of = 03/10/2026. AP = atterrissage plan, AT = atterrissage tendance, NC = non consommé à la date de fin. Pour une enveloppe 2026, la période va de S01 à S53 (28/12/2026 → 03/01/2027) : le PPS planifié en 2027 est hors enveloppe.

| CT | Libellé | Période | Enveloppe | Démontre | Statut attendu |
|---|---|---|---:|---|---|
| Y99F90008 | Comité d'Architecture | 2026 | 50 000 € | **Sur-imputation** : AP 60 023 € | dépassement |
| Y99F90602 | Support exploitation 24/7 | 2026 | 38 000 € | **Sur-imputation** (AP 53 951 €) et 34 374 € de plan 2027 hors enveloppe | dépassement |
| Y99F900014 | Achats non stockables | 2026 | 0 € | Enveloppe nulle mais 368 € consommés | dépassement |
| Y99F90001 | Alpha Core Team | 2026 | 108 000 € | AP 99 494 € dans les 95 %, mais tendance à 122 109 € ; NC 8 506 € (7,9 %) sous le seuil | vigilance |
| Y99F900012 | Provisions pour aléas | 2026 | 79 000 € | AP 76 434 € au-delà de 95 %, **et** tendance (59 913 €) très en dessous : NC 19 087 €. Un CT peut être à la fois en vigilance et en sous-consommation. Les 100 000 € de provisions ne comptent pas (marge) | vigilance + sous-conso |
| Y99F90601 | Squad Académie & Montée en compétence | 2026 | 31 000 € | **Conforme** : AP 27 045 €, AT 29 052 €, NC 3 955 € (< 5 000 €) | ok |
| Y99F90006 | Squad Development Experience | 2026 | 130 000 € | **Sous-imputation** : AP 99 474 €, AT 84 799 €, NC 45 201 € | ok + sous-conso |
| Y99F90003 | Data Stack - management de la donnée | 2026 | 100 000 € | **Sous-imputation** : AP 78 608 €, AT 65 922 €, NC 34 078 € | ok + sous-conso |
| Y99F90007 | Intégration système & MBSE | 01/09 → 30/11/2026 | 72 000 € | Période qui **finit avant le plan** : AP 64 772 € et 20 624 € de PPS (décembre et 2027) hors enveloppe. La fin, un lundi, inclut toute la S49. Tendance basse (33 728 €) : NC 38 272 € | ok + sous-conso |
| Y99F90002 | Platform Cloud | 01/01 → 30/09/2026 | 15 000 € | Enveloppe **terminée** : les 859 € imputés par BONNET les 01–02/10 sont du réalisé hors enveloppe ; consommé 6 875 €, le reste (8 125 €) est perdu | ok + sous-conso |
| Y99F90701 | Pilote IA générative | 01/01 → 31/03/2027 | 4 000 € | Enveloppe **future** : rien de consommé, AP 3 437 € (PETIT Karim à 20 % à partir du 04/01/2027). La S53 de 2026 fait partie de la période | ok |
| Y99F900015 | Fonds de transformation | 2027 | 40 000 € | CT présent **seulement dans les provisions** : aucun plan, donc toute l'enveloppe est non consommée | ok + sous-conso |

CT **sans enveloppe** (absents du fichier, ou ligne rejetée pour Y99F900013) : ils gardent la charge max comme budget (source « Reconstruit ») :
Y99F90004, Y99F90005, Y99F900010, Y99F900011, Y99F900013, Y99F900021, Y99F900022, Y99F90009.

Synthèse `previsions.enveloppes` attendue : 12 CT configurés sur 20, Σ enveloppes 667 000 €, 3 dépassements (26 342 €), 6 sous-consommations (203 823 € non consommés), 197 953 € de plan hors enveloppe. La timeline compte 123 segments pour Σ PPS = 1 181 434,37 €, comme l'étape 6 de `../timeline/`.

### Pourquoi ces montants

Pour une enveloppe 2026 commencée avant le réalisé, AP et AT sont la `projection_plan_echeance` et la `projection_tendance_echeance` au 31/12/2026. Le statut et la sous-consommation en découlent :
- dépassement si AP > enveloppe ;
- vigilance si AT > enveloppe ou AP > 95 % ;
- sous-consommation si l'enveloppe moins la plus basse des deux projections dépasse 10 % **et** 5 000 €.

Pour être **ok sans sous-consommation**, il faut donc AP ≤ 95 % de l'enveloppe, AT ≤ enveloppe et un écart à la plus basse projection ≤ 10 % ou ≤ 5 000 €.

Sur 2026, Alpha Core Team (90001) et Provisions pour aléas (90012) ne peuvent pas l'être : leur tendance s'écarte de plus de 10 % du plan (au-dessus pour 90001, en dessous pour 90012). Le cas conforme est donc porté par 90601.

Si le réalisé ou la timeline changent, refais les calculs avec `GET /api/analyse`, puis ajuste les montants du CSV, régénère `demo_cat.xlsx` et lance `--enveloppes-only`.
