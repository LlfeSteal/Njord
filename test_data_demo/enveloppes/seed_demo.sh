#!/usr/bin/env bash
# Charge toute la démo Njord par l'API : timeline du plan de charge (6 versions),
# réalisé, provisions, puis les enveloppes par CT (demo_enveloppes.xlsx, format « CàT par CT »).
# Voir test_data_demo/enveloppes/README.md.
set -euo pipefail

API="${API:-http://localhost:8080/api}"
API="${API%/}"
IMPORTEUR="seed-demo"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO="$(cd "$HERE/.." && pwd)"
CAT="$DEMO/demo_enveloppes.xlsx"

usage() {
	cat <<EOF
Usage : $(basename "$0") [--enveloppes-only] [--help]

Charge les données de démonstration dans Njord par l'API (\$API, défaut
http://localhost:8080/api ; actuel : $API).

  (sans option)       base vide attendue : importe les 6 versions du plan de charge
                      (timeline, avec leurs dates d'effet), le réalisé, les
                      provisions, puis importe les enveloppes par CT.
  --enveloppes-only   importe seulement les enveloppes de demo_enveloppes.xlsx
                      (POST /enveloppes/import, rejouable : chaque import
                      remplace toutes les enveloppes).
  --help              affiche cette aide.

Exemple : API=http://localhost:8091/api $0
EOF
}

MODE=all
for arg in "$@"; do
	case "$arg" in
	--enveloppes-only) MODE=enveloppes ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "Option inconnue : $arg" >&2
		usage >&2
		exit 2
		;;
	esac
done

command -v curl >/dev/null || { echo "curl est requis." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 est requis." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BODY="$TMP/body"

# req METHOD PATH [arguments curl…] : écrit la réponse dans $BODY, met le code
# HTTP dans $CODE (000 si le serveur est injoignable). N'échoue pas.
CODE=000
req() {
	local method="$1" path="$2"
	shift 2
	CODE="$(curl -sS -o "$BODY" -w '%{http_code}' -X "$method" "$@" "$API$path" 2>"$TMP/err")" || CODE=000
	[ -n "$CODE" ] || CODE=000
}

# must METHOD PATH [arguments curl…] : comme req, mais s'arrête si le code n'est pas 2xx.
must() {
	local method="$1" path="$2"
	req "$@"
	case "$CODE" in
	2??) ;;
	000)
		echo "ERREUR : $method $API$path : serveur injoignable ($(cat "$TMP/err"))." >&2
		exit 1
		;;
	*)
		echo "ERREUR : $method $API$path → HTTP $CODE" >&2
		cat "$BODY" >&2
		echo >&2
		exit 1
		;;
	esac
}

# json_get EXPR : évalue EXPR (Python, la réponse JSON est dans `d`) sur $BODY.
json_get() {
	python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$BODY" "$1"
}

check_health() {
	must GET /health
	echo "API joignable : $API"
}

# import_file KIND FICHIER INTITULE [DATE_EFFET]
import_file() {
	local kind="$1" file="$2" intitule="$3" date_effet="${4:-}"
	[ -f "$file" ] || { echo "ERREUR : fichier introuvable : $file" >&2; exit 1; }
	local args=(-F "file=@$file" -F "intitule=$intitule" -F "importeur=$IMPORTEUR" -F "archive_active=true")
	[ -z "$date_effet" ] || args+=(-F "date_effet=$date_effet")
	must POST "/$kind/imports" "${args[@]}"
	local resume
	resume="$(json_get '"%s lignes, %s warn, %s drop" % (d["version"]["nb_lignes"], d["version"]["nb_warn"], d["version"]["nb_drop"])' 2>/dev/null || echo "importé")"
	printf '  %-9s %-40s %-10s %s\n' "$kind" "$(basename "$file")" "${date_effet:--}" "$resume"
	# importee_le est à la seconde près et départage les versions de plan (ordre
	# d'import : réimport à même date d'effet, « plan connu au ») : deux imports
	# dans la même seconde seraient ordonnés au hasard (par id).
	[ "$kind" != plan ] || sleep 1
}

import_all() {
	must GET /plan/versions
	local n
	n="$(json_get 'len(d or [])')"
	if [ "$n" != "0" ]; then
		cat >&2 <<EOF
ERREUR : la base contient déjà $n version(s) de plan de charge.
Le scénario de démo suppose une base vide (les dates d'effet de la timeline
se mélangeraient aux versions existantes). Au choix :
  - repartir d'une base vide : arrêter le backend, supprimer backend/data/njord.db*
    (ou lancer le backend avec un autre --db), relancer puis rejouer ce script ;
  - ne charger que les enveloppes : $0 --enveloppes-only
EOF
		exit 1
	fi

	local tl="$DEMO/timeline"
	echo "Imports (importeur = $IMPORTEUR) :"
	import_file plan "$tl/1_PDC_2026-09_septembre.xlsx" "PDC septembre 2026" 2026-09-07
	import_file plan "$tl/2_PDC_2026-10_octobre.xlsx" "PDC octobre 2026" 2026-10-01
	import_file plan "$tl/3_PDC_2026-10_octobre_correctif.xlsx" "PDC octobre 2026 (correctif)" 2026-10-01
	import_file plan "$tl/4_PDC_2026-11_novembre.xlsx" "PDC novembre 2026" 2026-11-01
	import_file plan "$tl/5_PDC_2026-12_decembre.xlsx" "PDC décembre 2026" 2026-12-14
	import_file plan "$tl/6_PDC_2026-08_retroactif.xlsx" "PDC août 2026 (rétroactif)" 2026-08-24
	import_file realise "$DEMO/demo_realise.xlsx" "Réalisé démo au 03/10/2026"
	import_file provision "$DEMO/demo_provision.xlsx" "Provisions démo octobre 2026"
}

# Import du fichier « CàT par CT » : remplace toutes les enveloppes (DECISIONS n° 18).
import_enveloppes() {
	[ -f "$CAT" ] || { echo "ERREUR : fichier introuvable : $CAT (le générer : voir README.md)" >&2; exit 1; }
	echo "Enveloppes ($(basename "$CAT")) :"
	must POST /enveloppes/import -F "file=@$CAT" -F "importeur=$IMPORTEUR"
	local resume
	resume="$(json_get '"%s ok, %s warn, %s drop" % (d["ok"], d["warn"], d["drop"]) + "".join(" ; %s × %s" % (n, m) for m, n in sorted((d.get("motifs_count") or {}).items()))' 2>/dev/null || echo "importé")"
	echo "  $resume"
}

check_health
if [ "$MODE" = all ]; then
	import_all
fi
import_enveloppes
