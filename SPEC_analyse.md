# SPEC_analyse — Corrélation Plan de charge ↔ Réalisé

Module `njord` · volet **exploitation et croisement** des deux sources gérées dans `SPEC_Plandecharge.md` et `SPEC_realise.md`.
Ne gère aucun cycle de vie, ne dépend d'aucune API : purement fonctionnel.

## 0. Conventions

Identiques aux deux SPEC gestion. Règles métier de référence (listes SECURISE/NON_SECURISE, seuils, tableau hebdo) reprises de `spec.md` racine, recopiées ici pour autonomie du document.

## 1. Rôle

Croiser la **version active du plan de charge** avec la **version active du réalisé** pour produire :

1. un tableau d'écarts d'imputation par ressource × CT × semaine ;
2. une synthèse budgétaire sécurisé vs non sécurisé par CT ;
3. des KPI consolidés (taux de conformité, points FLAG, taux d'absence, alertes).

## 2. Entrées attendues

| Entrée | Origine | Défaut |
|---|---|---|
| Version du plan | la version `active` | override utilisateur : sélection explicite d'une version archivée pour audit |
| Version du réalisé | la version `active` | idem |
| Paramètres métier | configuration | seuils, calendrier, période d'analyse |

Les lignes `statut_parsing = drop` sont exclues. Les lignes `warn` sont conservées mais signalées dans le rendu.

## 3. Enrichissement du réalisé

Appliqué à chaque écriture de la version retenue (recalcul à la demande, jamais persisté côté gestion).

### 3.1 Distinction heures / €

```
MO_TYPES = { "MAIN D'OEUVRE SUR SITE", "CAPACITE SUR SITE" }

si TYPE ∈ MO_TYPES :
    heures = QUANTITE        ; eur = 0
sinon :
    heures = 0               ; eur = TOTAL_EN_EUR
```

Règle destinée à éviter le double-comptage MO dans le budget global.

### 3.2 Semaine ISO

`iso_week = ISO 8601 week of DATE DEPENSE` (format `YYYY-Www`).
Vérification de cohérence avec `PERIODE COMPTABLE` : si l'écart dépasse 7 jours → `warn` remontée à l'utilisateur.

### 3.3 Classification budgétaire

Listes de référence :

```
SECURISE = [
  "MAIN D'OEUVRE SUR SITE",
  "CAPACITE SUR SITE",
  "FRAIS ACHATS CAPACITE SUR SITE",
  "FRAIS DE MISSION",
]
NON_SECURISE = [
  "PROVISIONS POUR ALEAS",
  "Stockage",
]
```

Comparaison **majuscules + trim** sur la colonne `TYPE` :

```
classification =
  SÉCURISÉ       si TYPE ∈ SECURISE
  NON_SÉCURISÉ   si TYPE ∈ NON_SECURISE
  NON_CLASSÉ     sinon
```

## 4. Dépliage hebdomadaire du plan

Chaque ligne de plan est répartie sur la période `[date_début, date_fin]` :

```
charge_hebdo(ligne, semaine) =
    charge_totale × (jours_ouvrés_semaine ÷ total_jours_ouvrés_période_ligne)
```

### 4.1 Calendrier de référence (S35 → S52)

| Semaine | Période | Jours ouvrés | 20% | 30% | 40% | 50% | 70% | 80% | 100% |
|---|---|---|---|---|---|---|---|---|---|
| S35 | 31/08 → 06/09 | 4 | 5.0 | 7.5 | 10.0 | 12.5 | 17.5 | 20.0 | 25.0 |
| S36 | 07 → 13/09 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S37 | 14 → 20/09 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S38 | 21 → 27/09 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S39 | 28/09 → 04/10 | 5 | 7.6 | 11.4 | 15.0 | 18.8 | 26.4 | 30.0 | 37.5 |
| S40 | 05 → 11/10 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S41 | 12 → 18/10 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S42 | 19 → 25/10 | 5 | 6.3 | 9.4 | 12.5 | 15.6 | 21.9 | 25.0 | 31.3 |
| S43 | 26/10 → 01/11 | 4 | 5.0 | 7.5 | 10.0 | 12.5 | 17.5 | 20.0 | 25.0 |
| S44 | 02 → 08/11 | 4 | 5.1 | 7.7 | 10.2 | 12.8 | 17.9 | 20.5 | 25.6 |
| S45 | 09 → 15/11 | 4 | 5.1 | 7.7 | 10.2 | 12.8 | 17.9 | 20.5 | 25.6 |
| S46 | 16 → 22/11 | 5 | 6.4 | 9.6 | 12.8 | 16.0 | 22.4 | 25.6 | 32.0 |
| S47 | 23 → 29/11 | 5 | 6.4 | 9.6 | 12.8 | 16.0 | 22.4 | 25.6 | 32.0 |
| S48 | 30/11 → 06/12 | 5 | 6.7 | 10.1 | 13.4 | 16.8 | 23.6 | 26.9 | 33.6 |
| S49 | 07 → 13/12 | 5 | 6.2 | 9.3 | 12.4 | 15.5 | 21.7 | 24.8 | 30.9 |
| S50 | 14 → 20/12 | 4 | 5.0 | 7.5 | 10.0 | 12.5 | 17.5 | 20.0 | 25.0 |
| S51 | 21 → 27/12 | 0 🔒 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| S52 | 28/12 → 03/01 | 0 🔒 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | 66 j | 110 | 165 | 220 | 275 | 385 | 440 | 550 |

Le tableau correspond à une charge annuelle de référence de 550 h. Pour une autre charge, recalculer via la formule.

**Verrous S51/S52** : `charge_hebdo = 0` même si la couverture temporelle de la ligne chevauche ces semaines.

### 4.2 Contrôle de cohérence

`Σ charge_hebdo` sur toutes les semaines couvertes doit être égal à `charge_totale` à ±0.5 h près. Sinon : `warn` global remonté.

## 5. Corrélation identité PDC ↔ Réalisé

Les deux sources n'exposent pas la même clé ressource ; seul le NOM + Prénom est commun (§5.1).

| Côté PDC | Côté Réalisé | Exemple |
|---|---|---|
| `Ressource` court `R_###` ou long `RES_ext_##` | `MATRICULE` `A#####` | non appairables directement |
| `Libellé` `<Prénom NOM>` \| `<Squad> / <Prénom NOM>` | `EMPLOYE/FOURNISSEUR` `<NOM Prénom M.>` | format différent |

### 5.1 Identité NOM + Prénom (seule stratégie)

Depuis le 2026-10-06 (DECISIONS n° 8), une ressource est identifiée **uniquement par NOM + Prénom** ; codes ressource, matricules et alias ne servent plus.

1. Côté PDC : NOM Prénom extrait du `Libellé` (SPEC Plan §8 règle 9). Ligne sans NOM Prénom → non nominative, jamais appariée.
2. Côté Réalisé : `EMPLOYE/FOURNISSEUR` `<NOM Prénom Civilité>` dont on **retire la civilité finale** (M., Mr., Mme., Mlle.…).
3. Clé = `NOM|PRÉNOM` en majuscules, sans accents ni ponctuation, **ordre conservé**. **Égalité stricte** → `confidence = nom`.
4. **Sinon** → écriture Réalisé non appariée → **🟠 Hors plan** (`confidence = none`).

### 5.2 Clé de jointure

Clé fonctionnelle du croisement :

```
(clé_CT, clé_ressource, iso_week)
```

où :
- `clé_CT` : code CT complet à 9 caractères (commun PDC `Tâche ou sous-projet` ↔ Réalisé `TG`) ;
- `clé_ressource` : clé NOM + Prénom (§5.1) ;
- `iso_week` : semaine ISO issue du dépliage §4 côté plan, de `DATE DEPENSE` côté réalisé.

## 6. Règles d'écart et flags

Pour chaque tuple joint, avec `écart = heures_réelles − heures_prévues` :

| Condition | Flag | Couleur |
|---|---|---|
| `heures_réelles == 0` et `heures_prévues > 0` | Absence totale | ⚫ |
| ressource présente au Réalisé mais pas au plan (stratégie §5.1 a échoué) | Hors plan | 🟠 |
| `écart > +15 h` | FLAG sur-imputation | 🔴 |
| `écart < −30 h` | FLAG sous-imputation | 🟣 |
| sinon | Conforme | 🟢 |

### 6.1 Agrégats de synthèse

| Agrégat | Formule |
|---|---|
| Points FLAG sur-imputation | `2 × nb 🔴` |
| Points FLAG sous-imputation | `1 × nb 🟣` |
| Points absence | `2 × nb ⚫` |
| Points hors plan | `Σ heures_hors_plan ÷ 12` (arrondi inférieur) |
| Taux de conformité | `nb 🟢 ÷ nb tuples comparés` |
| Taux d'absence | `nb personnes avec Σ réel = 0 et Σ prévu > 0 ÷ nb personnes planifiées` |

## 7. Restitutions fonctionnelles

### 7.1 Tableau d'écarts

Par ressource × CT × semaine ISO, colonnes :
`Ressource` · `CT` · `Semaine` · `Prévu (h)` · `Réel (h)` · `Écart (h)` · `Flag`.

Filtres utilisateur : CT, ressource, plage de semaines, flag, squad.
Tri par défaut : flag (gravité décroissante), puis |écart| décroissant.

### 7.2 Export CSV conformité

Téléchargeable depuis l'écran d'analyse, contient le tableau §7.1 (avec les filtres appliqués).

### 7.3 Export CSV réalisé enrichi

Les écritures de la version réalisée retenue, avec les colonnes dérivées §3 (`iso_week`, `heures`, `eur`, `classification`) en sus des colonnes brutes. Respecte le masquage des colonnes sensibles selon le rôle.

### 7.4 Synthèse budgétaire

Consolidation par CT :

```
┌────────────────────────────────────────────────┐
│  CT_xxxxxxxxx                                  │
│   🔒 SÉCURISÉ     : Σ eur (classification = SÉCURISÉ)     │
│   ⚠️ NON_SÉCURISÉ : Σ eur (classification = NON_SÉCURISÉ) │
│   NON_CLASSÉ      : Σ eur (classification = NON_CLASSÉ)   │
│   % sécurité      : SÉCURISÉ ÷ (SÉCURISÉ + NON_SÉCURISÉ)  │
└────────────────────────────────────────────────┘
```

Consolidation globale : `% sécurité global = Σ sécurisé ÷ Σ (sécurisé + non sécurisé)`.

### 7.5 Alertes

- **CT à risque** : lister les `TG` dont `Σ eur NON_SÉCURISÉ > 10 000 €` (seuil paramétrable).
- **Alerte globale** si `% non sécurisé > 15 %` (seuil paramétrable).
- **Dérive de provision** : lignes `PROVISIONS POUR ALEAS` consommées sans rattachement à une ressource identifiée.

### 7.6 KPI de dashboard

Cartes affichées en tête d'écran :
- taux de conformité ;
- points FLAG (répartis sur-imputation / sous-imputation / absence / hors plan) ;
- taux d'absence (`nb ⚫ ÷ nb planifiés`) ;
- % budget sécurisé ;
- nombre de CT à risque.

### 7.7 Prévisions (atterrissage)

Ajout 2026-10-05 (contrôle de gestion). Horizon = tout le plan, indépendant de la période d'analyse.

- `as_of` = dernière date de dépense du réalisé.
- Budget d'un CT = Σ PPS des lignes du plan ; dépense prévue hebdomadaire = PPS réparti au prorata des heures (jours ouvrés, §4).
- Consommé = Σ TOTAL EN € brut (MO comprise) jusqu'à `as_of`.
- **Atterrissage plan** = consommé + reste à faire du plan (semaines postérieures à `as_of`).
- **Atterrissage tendance** = consommé + rythme moyen des 4 dernières semaines × semaines restantes jusqu'à la fin du plan du CT.
- Statut : `depassement` si atterrissage plan > budget ; `vigilance` si tendance > budget ou atterrissage plan > 95 % du budget ; `ok` sinon.
- Séries hebdomadaires cumulées (budget, réel, projections plan et tendance) et heures MO planifiées / réalisées.

### 7.8 Anomalies (boîte de réception)

Ajout 2026-10-05. Liste unique des points à vérifier, chacun avec une clé stable et une empreinte de ses chiffres :
écarts d'imputation (regroupés par ressource × CT × flag, hors conformes), CT à risque, dérives de provision, contrôles qualité (§10), correspondances approximatives à confirmer, prévisions en dépassement / vigilance.
Le contrôleur marque une anomalie **traitée** ou **ignorée** avec un commentaire (journal d'audit) ; si l'empreinte change, elle redevient **à traiter**.

## 8. Comportements d'écran (onglet Analyse)

- Sélecteur version plan (défaut : active, override archivée possible) ;
- sélecteur version réalisé (mêmes règles) ;
- sélecteur de période d'analyse (par défaut : intersection des périodes couvertes) ;
- badges couleur (⚫ 🟠 🔴 🟢 🟣) dans le tableau et les KPI ;
- **analyse budgétaire** (page Budget) : barres PPS vs réalisé par nature de coût — Provision, Main d'œuvre, Capacité, Frais de mission, Autres (DECISIONS n° 10) ;
- **synthèse des imputations** (page Écarts) : anneau des heures sur-imputées, sous-imputées, hors plan et conformes, et nombre de personnes du plan n'ayant rien imputé sur la période (DECISIONS n° 9) ;
- drill-down : clic sur une ligne CT → filtres pré-remplis vers le tableau d'écarts ;
- bouton "Exporter CSV conformité" et "Exporter CSV réalisé enrichi".

## 9. Cas particuliers

| Cas | Comportement |
|---|---|
| Version plan archivée sélectionnée explicitement | analyse produite avec avertissement persistant "version archivée en lecture" |
| Version réalisé sans plan actif | analyse impossible → message invitant à importer/activer un plan |
| Ressource `[inactif]` présente au plan | conservée, flag `inactive` affiché, exclue du calcul du taux de conformité par défaut (toggle inclus) |
| Semaine verrouillée (S51/S52) | `heures_prévues = 0`, écritures réalisées imputées sur ces semaines → **🟠 Hors plan** |
| Écritures réalisées en montant négatif (avoir) | conservées, contribuent négativement au Σ € et au calcul % sécurité |
| Écriture MO sans NOM Prénom identifiable | 🟠 Hors plan + `warn` global |
| Ressource avec 100 % d'absence sur une seule semaine mais réelle ailleurs | ne déclenche pas ⚫ (règle : ⚫ = `Σ heures_réelles = 0` sur **toute** la période analysée) |

## 10. Contrôles qualité métier

Appliqués **au moment du rendu**, remontés dans une bannière dédiée.

| # | Règle | Comportement |
|---|---|---|
| 1 | `Σ TOTAL EN €` par TG vs agrégat attendu métier | warn si écart > seuil absolu |
| 2 | lignes MO avec `QUANTITE > 200 h` sur une semaine | warn (imputations physiquement impossibles) |
| 3 | ~~correspondances fuzzy > seuil~~ | **supprimée** (2026-10-06) : plus de correspondance approximative |
| 4 | lignes Réalisé sans `TG` | exclues de l'analyse, comptées dans le warn |
| 5 | lignes Réalisé dont `PERIODE COMPTABLE < DATE DEPENSE − 7 j` | warn |

## 11. Hors périmètre

- Réconciliation comptable fine (lettrage factures, imputation analytique).
- Multi-devises : toutes les écritures sont en €.
- Historisation des rendus d'analyse : seul le dernier rendu est conservé.
- Détection automatique d'alias par méthode probabiliste (Levenshtein, distance cosinus…).
