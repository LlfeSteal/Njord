# Jeu de test — Provisions (`../demo_provision.xlsx`)

Export Planisware « Dépenses prévues » (EUR) fictif. Il liste les fonds de provision restants (non engagés) par CT et sert à recetter le 3ᵉ import :

- **charge max(CT)** = Σ PPS du PDC (segments de la timeline) + Σ provisions(CT) ;
- **budget** = Σ charge max ;
- les provisions ne sont qu'un plafond : l'**atterrissage plan** reste consommé + reste à faire du PDC.

Le fichier reprend la structure de l'export réel `../Export Provisions Octobre_DEMO.xlsx` :
- onglet `Style par défaut` ;
- bandeau en ligne 1 (date d'export en texte `08/10/26`, `Dépenses prévues`, `Utilisateur ext-demo.test`) ;
- en-tête de 12 colonnes en ligne 3 ;
- groupes projet (WP du réalisé) > sous-projet (libellé du CT), chacun suivi de sa ligne `Somme` ;
- lignes de dépense : `.PPS` = `Quantité`, `Date de fin` = début + 1, `Depuis` = début − 46035 j. Il n'y a pas de total général.

À importer avec la timeline complète (`../timeline/`, étapes 1 à 6) et le réalisé démo (`../demo_realise.xlsx`, as_of = 03/10/2026, S40).

## Régénérer

```
python3 test_data_demo/generateur_provision/gen.py
```

Le script écrit `../demo_provision.xlsx` avec `write/main.go` (excelize, module Go du backend copié dans un dossier temporaire puis supprimé). Il écrit aussi `attendus.csv`, l'oracle. Les montants sont fixés en dur dans `PROVISIONS` (`gen.py`), et chaque CT y est commenté.

## Scénarios

| CT | Libellé | Provisions | Lignes / dates | Démontre | Statut sans → avec |
|---|---|---:|---|---|---|
| Y99F900011 | Réserve de capacité Site Loire | 60 030 € | 3 paires HA/FHA (`CAPACITE SUR SITE` / `FRAIS ACHATS…`, FHA ≈ 3,5 %), 30/10, 27/11, 31/12 | AP sous le budget, mais tendance (21 k€/sem) au-dessus | dépassement → **vigilance** |
| Y99F900012 | Provisions pour aléas | 100 000 € | 1 ligne `Provision`, 31/12/2026, `Dates fixes` | Grosse provision sur un CT déjà sain | ok → ok |
| Y99F900013 | Prestations externes | 30 000 € | 2 paires HA/FHA prestations, 13/11 et 31/12 | CT hors plan désormais budgété | dépassement → **ok** |
| Y99F900014 | Achats non stockables | 5 000 € | HA/FHA matière, 16/10 | idem | dépassement → **ok** |
| Y99F900021 | Missions PI Planning | 25 000 € | 2 lignes, 31/12 | idem | dépassement → **ok** |
| Y99F900022 | Missions Sprint Planning | 19 000 € | 1 ligne, 31/12 | Consommé 18 429 € = 97 % du budget | dépassement → **vigilance** |
| Y99F90004 | Squad UI Experience | 20 000 € | `Provision MO +1 ETP`, 31/12 | AP couvert, mais la tendance dépasse | dépassement → **vigilance** |
| Y99F90006 | Squad Development Experience | 15 000 € | `Provision MO`, 31/12 | Sort de la zone des 95 % | vigilance → **ok** |
| Y99F90601 | Squad Académie & Montée en compétence | 12 000 € | `Provision MO`, 31/12 | Dépassement absorbé | dépassement → **ok** |
| Y99F90009 | Cellule Transverse Qualité | 4 000 € | `Provision recette T4`, 30/11 | **Seul CT encore en dépassement malgré sa provision** (AP 78 642 > 74 810) | dépassement → dépassement |
| Y99F90701 | Pilote IA générative¹ | 15 000 € | `Provision MO…`, **31/03/2027** | Nouveau CT du PDC de décembre, provision en 2027 | vigilance → **ok** |
| Y99F900015 | Fonds de transformation¹ | 40 000 € | 1 ligne, 31/03/2027 | CT présent **uniquement** dans les provisions (ni plan, ni réalisé) | absent → ok |

¹ Libellé inventé : ces CT n'ont aucune dépense dans le réalisé. Y99F90701 est placé sous `Programme Démo — Data & IA` et Y99F900015 sous `Réserve de capacité & aléas`.

Les autres CT n'ont pas de provision et gardent leur statut : Y99F90008 et Y99F90602 restent en dépassement, Y99F90001 et Y99F90005 en vigilance.

## Totaux

- 22 lignes, 12 CT, 7 projets.
- **Σ provisions = 345 030 €**, soit 29,2 % du PDC de l'étape 6 (1 181 434,37 €).
- Budget (charge max) = **1 526 464,37 €**. Consommé = 395 218,67 €. Atterrissage plan ≈ 1 257 490 €.
- Dates : du 16/10/2026 au 31/03/2027, avec un pic au 31/12/2026 (11 lignes).

## Oracle (`attendus.csv`)

Colonnes : `CT;Libellé;PPS PDC;Provisions;Charge max;Consommé;Reste à faire (approx);Atterrissage plan;Statut sans provisions;Statut attendu`. Il y a une ligne par CT du plan, du réalisé ou des provisions, plus une ligne `TOTAL`.

⚠️ Les statuts viennent d'une **approximation du moteur** (`fcStatut`, `backend/internal/analyse/forecast.go`) :
- le reste à faire = PPS des semaines postérieures à S40, au prorata des jours ouvrés (fériés et S51/S52 exclus) ;
- la tendance = consommé + moyenne des 4 dernières semaines × semaines restantes.

L'intégrateur valide ces statuts contre l'API réelle et peut ajuster les montants. Les marges ont été choisies larges, sauf pour Y99F900022, volontairement à 97 %.
