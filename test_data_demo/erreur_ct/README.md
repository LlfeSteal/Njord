# Jeu de test — Erreur de CT

Ce jeu sert à recetter la décision n° 14 de `docs/DECISIONS.md` et le §6.2 de `SPEC_analyse.md`. Quand une personne impute sur un CT où elle n'est pas planifiée au lieu de son CT planifié, l'analyse affiche une **Erreur de CT**. Elle n'affiche plus une sur-imputation d'un côté et une sous-imputation de l'autre.

`demo_plancharge_erreur_ct.xlsx` est une copie de `../demo_plancharge.xlsx`. Seule la colonne `Tâche ou sous-projet` de 3 lignes change ; charges, PPS, squads et lignes `Somme` sont identiques (36 lignes, 31 ok, 5 warn, 8 850,25 h, 1 014 061,63 €). Le réalisé est celui d'origine, `../demo_realise.xlsx` : les personnes continuent d'imputer leurs anciens CT.

| Ligne | Personne | CT dans la démo (imputé au réalisé) | CT dans ce plan | Même WP |
|---|---|---|---|---|
| 18 | PETIT Karim (MO 60 %) | Y99F90003 Data Stack | **Y99F90005** Engineering Experience | Y99F90100 |
| 40 | GIRAUD Léa (CAP 60 %) | Y99F90009 Cellule Transverse Qualité | **Y99F90007** Intégration système & MBSE | Y99F90200 |
| 39 | MARTIN Théo (MO 20 %, sa ligne 100 % reste sur Y99F90001) | Y99F90007 | **Y99F90008** Comité d'Architecture | Y99F90200 |

## A. Base vide : plan + réalisé

1. Importez `demo_plancharge_erreur_ct.xlsx` dans **Plan de charge** (date d'effet pré-remplie : 01/09/2026).
2. Importez `../demo_realise.xlsx` dans **Réalisé**.
3. Ouvrez **Écarts** avec le filtre « Erreur de CT » (`/ecarts?flag=erreur_ct`).

Résultats attendus (période S36 → S40, seuils 15 h / 30 h). Ils sont vérifiés par `TestErreurCTDemo` dans `backend/internal/analyse/engine_test.go`.

| Personne | Semaines | Ce qu'on voit | Pourquoi |
|---|---|---|---|
| PETIT Karim | S36, S37, S38, S40 | Y99F90003 (imputé à tort) **et** Y99F90005 (planifié, 0 h) en Erreur de CT, chacun lié à l'autre | sans la règle : sur-imputation sur Y99F90003 (> 15 h) et rien sur Y99F90005 (−25,7 h, sous le seuil de 30 h) |
| PETIT Karim | S39 | les deux CT restent **conformes** (mention dans l'inspecteur) | 15 h imputées : aucun seuil n'est dépassé, il n'y a rien à expliquer |
| GIRAUD Léa | S36, S37, S38 | Erreur de CT sur Y99F90009 et Y99F90007 | idem PETIT Karim |
| GIRAUD Léa | S40 | Y99F90009 **reste sur-imputé** (52,5 h, dont 25,66 h réaffectées), Y99F90007 reste conforme | cas partiel côté imputé : même après réaffectation, il reste +26,8 h au-delà du seuil |
| MARTIN Théo | S39 | Y99F90001 (−35,3 h) et Y99F90007 (7,5 h) en Erreur de CT ; Y99F90008 reste conforme | les 7,5 h ramènent Y99F90001 à −29,2 h, sous le seuil. Y99F90008 était déjà conforme et reçoit une part : il reste conforme |
| MARTIN Théo | S38 | Y99F90001 **reste en sous-imputation**, « dont 3,02 h imputées sur Y99F90007 » | cas partiel côté planifié : 3,75 h ne suffisent pas, il reste −32,3 h |

KPI : `nb_erreur_ct` = 16, `points_erreur_ct` = 8, 160,25 h dans la part « erreur de CT » de l'anneau.

Anomalies :

| Titre | Détail |
|---|---|
| PETIT Karim · imputé sur Y99F90003 au lieu de Y99F90005 | 4 semaines, 83,28 h imputées sur Y99F90003 au lieu de Y99F90005 (prévu 97,51 h) |
| GIRAUD Léa · imputé sur Y99F90009 au lieu de Y99F90007 | 3 semaines, 65,53 h imputées sur Y99F90009 au lieu de Y99F90007 (prévu 71,85 h) |
| GIRAUD Léa · Y99F90009 : sur-imputation | 1 semaine, écart cumulé +26,84 h (prévu 0 h, réel 52,5 h), dont 25,66 h imputées au lieu de Y99F90007 |
| MARTIN Théo · imputé sur Y99F90007 au lieu de Y99F90001 | 1 semaine, 7,5 h imputées sur Y99F90007 au lieu de Y99F90001 (prévu 42,77 h) |
| MARTIN Théo · Y99F90001 : sous-imputation | 1 semaine, écart cumulé -32,25 h (prévu 42,77 h, réel 7,5 h), dont 3,02 h imputées sur Y99F90007 |

On ne voit plus d'anomalie de sur-imputation pour PETIT Karim sur Y99F90003.

## B. Base qui contient déjà le scénario timeline (`../timeline/`)

Importez le plan avec la **date d'effet 07/09/2026**. Il remplace alors `1_PDC_2026-09_septembre` (même date d'effet, importé après) et fait référence du 07/09 au 30/09 ; la version 3 reprend la main le 01/10. Avec la date pré-remplie (01/09), il ne couvrirait que du 01/09 au 06/09.

```
curl -F file=@test_data_demo/erreur_ct/demo_plancharge_erreur_ct.xlsx -F date_effet=2026-09-07 http://localhost/api/plan/imports
```

Résultat constaté le 07/10/2026 (période S35 → S40) :
- 10 tuples en Erreur de CT (S37 à S39), 5 points, 93,75 h ;
- PETIT Karim : 2 semaines, 41,25 h ;
- GIRAUD Léa : 2 semaines, 45 h ;
- MARTIN Théo : S39 ;
- S36 et S40 diffèrent du cas A, car elles sont en partie hors de la fenêtre du plan.

Pour annuler : archivez ou purgez la version importée ; `1_PDC_2026-09_septembre` refait référence.
