#!/usr/bin/env python3
"""Génère l'export Provisions démo (Planisware « Dépenses prévues », EUR).

Usage : python3 test_data_demo/generateur_provision/gen.py
Sortie : test_data_demo/demo_provision.xlsx (écrit par write/main.go avec
excelize, module Go du backend, dans un dossier temporaire) et
test_data_demo/generateur_provision/attendus.csv (oracle approché).

Le classeur reprend la structure de « Export Provisions Octobre_DEMO.xlsx » :
bandeau en ligne 1, en-tête de 12 colonnes en ligne 3, puis projet (WP) >
sous-projet (libellé du CT) > lignes de dépense, chaque groupe suivi de sa
ligne « Somme ». Pas de total général.

Règle métier recettée : charge max(CT) = Σ PPS du PDC + Σ provisions(CT) ;
budget = Σ charge max. Les provisions ne sont qu'un plafond : l'atterrissage
plan reste consommé + reste à faire du PDC.
"""
import collections
import csv
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.dirname(HERE)
BACKEND = os.path.join(DEMO, "..", "backend")
OUT_XLSX = os.path.join(DEMO, "demo_provision.xlsx")
OUT_CSV = os.path.join(HERE, "attendus.csv")
SEGMENTS = os.path.join(DEMO, "timeline", "attendus", "etape6_segments.csv")
REALISE = os.path.join(DEMO, "demo_realise.xlsx")

D = dt.date.fromisoformat
EPOCH = dt.date(1899, 12, 30)
DEPUIS0 = 46035  # origine de la colonne « Depuis » de l'export réel (J = G - 46035 jours)
EXPORT_DATE = "08/10/26"  # A1 : date d'export, en TEXTE comme dans le fichier réel
FERIES = {D(x) for x in ["2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25", "2027-01-01"]}
LOCKED = {51, 52}  # semaines verrouillées (réglage par défaut)
TOL = 0.5  # tolérance du moteur (fcTolerance)


def serial(d):
    return (d - EPOCH).days


# ------------------------------------------------------------- provisions
# Calibrage (voir README) — PDC = timeline après l'étape 6 (Σ PPS 1 181 434,37 €),
# réalisé = demo_realise.xlsx (as_of 03/10/2026, S40). Chiffres indicatifs avant
# provisions : atterrissage plan (AP) = consommé + PPS des semaines > S40.
MO, CAP, FHA = "PROVISIONS POUR ALEAS", "CAPACITE SUR SITE", "FRAIS ACHATS CAPACITE SUR SITE"
PRESTA, FHA_PRESTA = "AUTRES PRESTATIONS", "FRAIS ACHATS PRESTATIONS"
NONSTOCK, FHA_MAT = "NON STOCKABLE", "FRAIS ACHATS MATIERE"
DP, DF = "Depuis-pendant", "Dates fixes"

# Libellés absents du réalisé (CT sans dépense) : inventés pour la démo.
EXTRA_LABELS = {
    "Y99F90701": ("Y99F90100 - Programme Démo — Data & IA", "Pilote IA générative"),
    "Y99F900015": ("Y99F90300 - Réserve de capacité & aléas", "Fonds de transformation"),
}

# (CT, libellé, montant €, ligne de coût, date, calcul de la durée)
PROVISIONS = [
    # Squad UI Experience — AP 65 754 > PPS 54 139 : dépassement. +20 000 → budget 74 139,
    # AP à 89 % mais tendance (rythme 6 742 €/sem × 17) 147 374 > budget : vigilance.
    ("Y99F90004", "Provision MO +1 ETP", 20000, MO, "2026-12-31", DF),
    # Squad Development Experience — AP 159 931 > 95 % de 166 972 : vigilance.
    # +15 000 → budget 181 972, AP à 88 %, tendance 145 703 : ok.
    ("Y99F90006", "Provision MO", 15000, MO, "2026-12-31", DF),
    # Nouveau CT du PDC de décembre (PETIT Karim dès le 04/01/2027) — AP = PPS 3 437 :
    # vigilance. Provision datée du 31/03/2027 → budget 18 437 : ok.
    ("Y99F90701", "Provision MO montée en charge 2027", 15000, MO, "2027-03-31", DF),
    # Cellule Transverse Qualité — AP 78 642 > PPS 70 810 (+7 832). Petite provision
    # de 4 000 → budget 74 810 : RESTE en dépassement (seul cas du jeu).
    ("Y99F90009", "Provision recette T4", 4000, MO, "2026-11-30", DP),
    # Réserve de capacité Site Loire — AP 236 863 > PPS 195 416 (+41 447) : dépassement.
    # Commandes HA / FHA (FHA ≈ 3,5 % du HA) : +60 030 → budget 255 446, AP à 93 %, mais
    # tendance (21 370 €/sem × 17) 472 977 > budget : vigilance.
    ("Y99F900011", "HA Presta Développement Site Loire T4", 24000, CAP, "2026-10-30", DP),
    ("Y99F900011", "FHA Presta Développement Site Loire T4", 840, FHA, "2026-10-30", DP),
    ("Y99F900011", "HA Presta Ingénierie Site Loire", 18000, CAP, "2026-11-27", DP),
    ("Y99F900011", "FHA Presta Ingénierie Site Loire", 630, FHA, "2026-11-27", DP),
    ("Y99F900011", "HA Presta Développement Agile Site Loire", 16000, CAP, "2026-12-31", DP),
    ("Y99F900011", "FHA Presta Développement Agile Site Loire", 560, FHA, "2026-12-31", DP),
    # Provisions pour aléas — déjà ok (AP 90 183 / PPS 99 341) : grosse provision de fin
    # d'année, reste ok (ok → ok).
    ("Y99F900012", "Provision", 100000, MO, "2026-12-31", DF),
    # Fonds de transformation — CT présent UNIQUEMENT dans les provisions (ni plan ni
    # réalisé) : budget 40 000, rien de consommé : ok.
    ("Y99F900015", "Provision fonds de transformation 2027", 40000, MO, "2027-03-31", DF),
    # Missions PI Planning — hors plan, consommé 6 400 : dépassement (budget 0) → ok.
    ("Y99F900021", "Missions PI Planning T4", 15000, MO, "2026-12-31", DP),
    ("Y99F900021", "Provision pour mission Equipe PI Planning", 10000, MO, "2026-12-31", DP),
    # Missions Sprint Planning — hors plan, consommé 18 429 : 19 000 → AP à 97 % du budget
    # (entre 95 et 100 %) : dépassement → vigilance.
    ("Y99F900022", "Provision pour mission Equipe Sprint Planning", 19000, MO, "2026-12-31", DP),
    # Prestations externes — hors plan, consommé 11 428 : HA/FHA 30 000 → ok.
    ("Y99F900013", "HA Prestation audit sécurité applicative", 19000, PRESTA, "2026-11-13", DP),
    ("Y99F900013", "FHA Prestation audit sécurité applicative", 650, FHA_PRESTA, "2026-11-13", DP),
    ("Y99F900013", "HA Prestation accompagnement agile T4", 10000, PRESTA, "2026-12-31", DP),
    ("Y99F900013", "FHA Prestation accompagnement agile T4", 350, FHA_PRESTA, "2026-12-31", DP),
    # Achats non stockables — hors plan, consommé 368 : 5 000 → ok.
    ("Y99F900014", "HA Petit matériel et consommables", 4800, NONSTOCK, "2026-10-16", DP),
    ("Y99F900014", "FHA Petit matériel et consommables", 200, FHA_MAT, "2026-10-16", DP),
    # Squad Académie & Montée en compétences — AP 35 639 > PPS 28 359 : dépassement.
    # +12 000 → budget 40 359, AP à 88 %, tendance 35 487 : ok.
    ("Y99F90601", "Provision MO", 12000, MO, "2026-12-31", DF),
]


# ---------------------------------------------------------------- lecture
def read_xlsx(path):
    """Première feuille d'un .xlsx → liste de lignes (stdlib : zipfile + xml)."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(ns + "si"):
            ss.append("".join(t.text or "" for t in si.iter(ns + "t")))
    rows = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(ns + "row"):
        idx = int(r.get("r"))
        while len(rows) < idx - 1:
            rows.append([])
        row = []
        for c in r.iter(ns + "c"):
            letters = re.match(r"[A-Z]+", c.get("r")).group()
            i = 0
            for ch in letters:
                i = i * 26 + ord(ch) - 64
            t, v = c.get("t"), c.find(ns + "v")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(ns + "t"))
            elif v is None:
                val = None
            elif t == "s":
                val = ss[int(v.text)]
            elif t in ("str", "b", "e"):
                val = v.text
            else:
                val = float(v.text)
            row += [None] * (i - 1 - len(row))
            row.append(val)
        rows.append(row)
    return rows


def workdays(a, b):
    out, d = [], a
    while d <= b:
        if d.weekday() < 5 and d not in FERIES and d.isocalendar()[1] not in LOCKED:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def week(d):
    return tuple(d.isocalendar()[:2])


def load_plan():
    """PPS, reste à faire (PPS des semaines > as_of, réparti en jours ouvrés) et fin par CT."""
    pps, segs, fin = collections.defaultdict(float), collections.defaultdict(list), {}
    with open(SEGMENTS, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter=";"):
            ct, p, a, b = r["CT"], float(r["PPS"].replace(",", ".")), D(r["Début"]), D(r["Fin"])
            pps[ct] += p
            segs[ct].append((p, a, b))
            fin[ct] = max(fin.get(ct, b), b)
    return pps, segs, fin


def load_realise():
    rows = read_xlsx(REALISE)
    ix = {k: i for i, k in enumerate(rows[0])}
    cons, reel = collections.defaultdict(float), collections.defaultdict(lambda: collections.defaultdict(float))
    labels, as_of = {}, None
    for r in rows[2:]:  # ligne 2 = Totaux
        if not r or not r[ix["Tâche code et description"]]:
            continue
        ct, lab = r[ix["Tâche code et description"]].split(" - ", 1)
        labels[ct] = (r[ix["WP code et description"]], lab)
        eur = round(r[ix["Coût détaillé"]] * 1000, 2)  # k€ → €
        d = EPOCH + dt.timedelta(days=int(r[ix["Date de dépense"]]))
        as_of = max(as_of or d, d)
        cons[ct] += eur
        reel[ct][week(d)] += eur
    return cons, reel, labels, as_of


# ----------------------------------------------------------------- oracle
def statut(budget, consomme, ap, at):
    """Approximation de fcStatut (backend/internal/analyse/forecast.go)."""
    if ap > budget + TOL or (budget == 0 and consomme > 0):
        return "depassement"
    if at > budget + TOL or ap > 0.95 * budget + TOL:
        return "vigilance"
    return "ok"


def oracle(prov):
    pps, segs, fin = load_plan()
    cons, reel, labels, as_of = load_realise()
    labels.update(EXTRA_LABELS)
    asw = week(as_of)
    monday = dt.date.fromisocalendar(*asw, 1)
    last4 = [week(monday - dt.timedelta(days=7 * k)) for k in range(4)]

    def remaining(f):  # semaines après as_of jusqu'à la semaine de fin (fcRemaining)
        if f is None:
            return 0
        z = dt.date.fromisocalendar(*week(f), 1)
        return max(0, round((z - monday).days / 7))

    out = []
    for ct in sorted(set(pps) | set(cons) | set(prov)):
        reste = 0.0
        for p, a, b in segs.get(ct, []):
            days = workdays(a, b)
            if days:
                reste += p * sum(1 for d in days if week(d) > asw) / len(days)
            elif week(a) > asw:
                reste += p
        rythme = sum(reel[ct][w] for w in last4) / 4
        sr = remaining(fin.get(ct))
        ap = cons[ct] + reste
        at = cons[ct] + rythme * sr
        out.append(dict(ct=ct, lib=labels.get(ct, ("", ""))[1], pps=pps[ct], prov=prov.get(ct, 0.0),
                        cons=cons[ct], reste=reste, ap=ap, at=at, rythme=rythme, fin=fin.get(ct)))
    for o in out:
        o["max"] = o["pps"] + o["prov"]
        # CT présent uniquement dans les provisions : n'existe pas sans elles.
        absent = o["pps"] == 0 and o["cons"] == 0 and not o["fin"]
        o["s0"] = "absent" if absent else statut(o["pps"], o["cons"], o["ap"], o["at"])
        o["s1"] = statut(o["max"], o["cons"], o["ap"], o["at"])
    tot = {k: sum(o[k] for o in out) for k in ("pps", "prov", "max", "cons", "reste", "ap", "rythme")}
    gfin = max(o["fin"] for o in out if o["fin"])
    tot["at"] = tot["cons"] + tot["rythme"] * remaining(gfin)
    tot["s0"] = statut(tot["pps"], tot["cons"], tot["ap"], tot["at"])
    tot["s1"] = statut(tot["max"], tot["cons"], tot["ap"], tot["at"])
    return out, tot, labels, as_of


def fr(x):
    return f"{x:.2f}".replace(".", ",")


def write_oracle(out, tot):
    with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(["CT", "Libellé", "PPS PDC", "Provisions", "Charge max", "Consommé", "Reste à faire (approx)",
                    "Atterrissage plan", "Statut sans provisions", "Statut attendu"])
        for o in out:
            w.writerow([o["ct"], o["lib"], fr(o["pps"]), fr(o["prov"]), fr(o["max"]), fr(o["cons"]),
                        fr(o["reste"]), fr(o["ap"]), o["s0"], o["s1"]])
        w.writerow(["TOTAL", "", fr(tot["pps"]), fr(tot["prov"]), fr(tot["max"]), fr(tot["cons"]),
                    fr(tot["reste"]), fr(tot["ap"]), tot["s0"], tot["s1"]])


# ---------------------------------------------------------------- classeur
def strip_code(s):
    return s.split(" - ", 1)[1] if " - " in s else s


def build_rows(labels):
    """Lignes du classeur + niveaux de plan, groupées WP > CT (ordre des codes WP)."""
    tree = collections.OrderedDict()
    for p in PROVISIONS:
        wp, _ = labels[p[0]]
        tree.setdefault(wp, collections.OrderedDict()).setdefault(p[0], []).append(p)
    rows = [[EXPORT_DATE, "", "", "", "Dépenses prévues", "", "", "", "Utilisateur ext-demo.test", "", "", ""],
            [],
            ["Tâche ou sous-projet", "Libellé", "Quantité", "Unité", "Ligne de coût", "Type de dépense",
             "Date de début", "Date de fin", "Calcul de la durée", "Depuis", "Pendant", ".PPS"]]
    levels = [0, 0, 0]

    def group(name, total, lvl):
        rows.append([name] + [""] * 11)
        rows.append(["Somme", None, total, None, None, None, None, None, None, "", "", total])
        levels.extend([lvl, lvl + 1])

    for wp in sorted(tree):
        cts = tree[wp]
        group(strip_code(wp), sum(p[2] for lines in cts.values() for p in lines), 0)
        for ct in sorted(cts):
            lines = sorted(cts[ct], key=lambda p: p[4])
            group(labels[ct][1], sum(p[2] for p in lines), 1)
            for ct_, lib, eur, lc, date, calc in lines:
                g = serial(D(date))
                rows.append([ct_, lib, eur, "EURO", lc, "Standard", g, g + 1, calc, f"{g - DEPUIS0}j", "1j", eur])
                levels.append(2)
    return rows, levels


def write_xlsx(rows, levels):
    go = shutil.which("go") or "/usr/local/go/bin/go"
    tmp = tempfile.mkdtemp(prefix="provgen-")
    try:
        # Module Go jetable reprenant les dépendances du backend (excelize).
        for f in ("go.mod", "go.sum"):
            with open(os.path.join(BACKEND, f)) as src, open(os.path.join(tmp, f), "w") as dst:
                dst.write(src.read().replace("module njord", "module provgen", 1))
        os.makedirs(os.path.join(tmp, "write"))
        shutil.copy(os.path.join(HERE, "write", "main.go"), os.path.join(tmp, "write", "main.go"))
        spec = [dict(path=os.path.abspath(OUT_XLSX), rows=rows, levels=levels, date_cols=[6, 7],
                     money_cols=[2, 11], date_from=4)]
        with open(os.path.join(tmp, "specs.json"), "w") as f:
            json.dump(spec, f, ensure_ascii=False)
        env = dict(os.environ, GOFLAGS="-mod=mod")
        subprocess.run([go, "run", "./write", "specs.json"], cwd=tmp, check=True, env=env)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    prov = collections.defaultdict(float)
    for p in PROVISIONS:
        prov[p[0]] += p[2]
    out, tot, labels, as_of = oracle(prov)
    rows, levels = build_rows(labels)
    write_xlsx(rows, levels)
    write_oracle(out, tot)

    print(f"as_of = {as_of:%d/%m/%Y} (S{as_of.isocalendar()[1]})")
    print(f"{len(PROVISIONS)} lignes, {len(prov)} CT, Σ provisions = {tot['prov']:,.2f} € "
          f"= {100 * tot['prov'] / tot['pps']:.1f} % du PDC ({tot['pps']:,.2f} €)")
    print(f"{'CT':11} {'PPS':>11} {'Prov.':>9} {'AP':>11} {'Tend.':>11}  sans → avec")
    for o in out:
        flag = "" if o["s0"] == o["s1"] else "  *"
        print(f"{o['ct']:11} {o['pps']:11.2f} {o['prov']:9.0f} {o['ap']:11.2f} {o['at']:11.2f}  {o['s0']} → {o['s1']}{flag}")
    print(f"→ {os.path.relpath(OUT_XLSX)} et {os.path.relpath(OUT_CSV)}")


if __name__ == "__main__":
    sys.exit(main())
