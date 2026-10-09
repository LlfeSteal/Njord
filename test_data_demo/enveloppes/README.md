# Jeu de démo — Enveloppes par CT (`demo_enveloppes.csv`)

Ce jeu sert à recetter les décisions n° 18 et n° 19 de `docs/DECISIONS.md` :
- une **enveloppe** = budget d'un CT sur sa propre période (date de début, date de fin, montant) ;
- pour un CT configuré, elle **remplace la charge max** (Σ PPS + provisions) comme budget ;
- **sur-imputation** = statut dépassement (atterrissage > enveloppe) ;
- **sous-imputation** = sous-consommation à la date de fin (non consommé > 10 % **et** > 5 000 €) ;
- le PPS planifié hors période est affiché à part (« plan hors enveloppe »), comme le réalisé hors période (« réalisé hors enveloppe »).

Il s'appuie sur toute la démo : la timeline du plan de charge (`../timeline/`, étapes 1 à 6), le réalisé (`../demo_realise.xlsx`, as_of = 03/10/2026, S40) et les provisions (`../demo_provision.xlsx`). Une enveloppe ne peut être saisie que pour un CT connu des sources (sinon 404) : les enveloppes se chargent donc **après** les imports.

## Charger la démo

`seed_demo.sh` charge tout par l'API, dans l'ordre : les 6 versions du plan avec leur date d'effet, le réalisé, les provisions, puis les enveloppes. Il ne dépend que de `bash`, `curl` et `python3`, et se lance depuis n'importe quel dossier.

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
- `--enveloppes-only` : ne fait que les `PUT /api/enveloppes/:ct` du CSV, sur une base où les imports sont déjà faits. Rejouable : chaque PUT écrase l'enveloppe du CT.
- `--help` : aide.

Le script refuse de tourner si la base contient déjà une version de plan : les dates d'effet de la timeline se mélangeraient aux versions existantes. Il marque une pause d'une seconde après chaque import de plan. L'heure d'import (`importee_le`, à la seconde près) départage en effet les versions : correctif n° 3 face à n° 2, « plan connu au ». Deux imports dans la même seconde seraient ordonnés au hasard. Compte une dizaine de secondes en tout. Il s'arrête au premier appel en erreur et affiche la réponse de l'API. Tous les imports et enveloppes sont signés `seed-demo` (importeur, opérateur).

Attendu après le chargement :
- **Plan de charge** : 6 versions, la n° 6 (rétroactive, 24/08/2026) active, les 5 autres archivées, aucune purgée ;
- **Enveloppes** : 20 CT, dont 12 configurés et 8 à configurer ;
- **Prévisions** : budget global de source `mixte`.

## Format du CSV

`ct;date_debut;date_fin;montant;commentaire`, UTF-8, séparateur `;`, dates `AAAA-MM-JJ`, montant en euros (point ou virgule décimale). Le corps JSON de chaque PUT est construit par `json.dumps` : un commentaire peut contenir des guillemets ou des `;` (entre guillemets CSV).

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

CT laissés **à configurer** : ils gardent la charge max comme budget (source « Reconstruit ») :
Y99F90004, Y99F90005, Y99F900010, Y99F900011, Y99F900013, Y99F900021, Y99F900022, Y99F90009.

Synthèse `previsions.enveloppes` attendue : 12 CT configurés sur 20, Σ enveloppes 667 000 €, 3 dépassements (26 342 €), 6 sous-consommations (203 823 € non consommés), 197 953 € de plan hors enveloppe. La timeline compte 123 segments pour Σ PPS = 1 181 434,37 €, comme l'étape 6 de `../timeline/`.

### Pourquoi ces montants

Pour une enveloppe 2026 commencée avant le réalisé, AP et AT sont la `projection_plan_echeance` et la `projection_tendance_echeance` au 31/12/2026. Le statut et la sous-consommation en découlent :
- dépassement si AP > enveloppe ;
- vigilance si AT > enveloppe ou AP > 95 % ;
- sous-consommation si l'enveloppe moins la plus basse des deux projections dépasse 10 % **et** 5 000 €.

Pour être **ok sans sous-consommation**, il faut donc AP ≤ 95 % de l'enveloppe, AT ≤ enveloppe et un écart à la plus basse projection ≤ 10 % ou ≤ 5 000 €.

Sur 2026, Alpha Core Team (90001) et Provisions pour aléas (90012) ne peuvent pas l'être : leur tendance s'écarte de plus de 10 % du plan (au-dessus pour 90001, en dessous pour 90012). Le cas conforme est donc porté par 90601.

Si le réalisé ou la timeline changent, refais les calculs avec `GET /api/analyse`, puis ajuste les montants du CSV et lance `--enveloppes-only`.
