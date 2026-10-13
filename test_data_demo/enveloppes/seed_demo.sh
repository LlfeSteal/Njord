#!/usr/bin/env bash
# Charge toute la démo Njord par l'API : timeline du plan de charge (6 versions),
# réalisé, provisions, puis les enveloppes par CT (une requête PUT /enveloppes/:ct par
# ligne de CT de demo_enveloppes.csv).
# Voir test_data_demo/enveloppes/README.md.
set -euo pipefail

API="${API:-http://localhost:8080/api}"
API="${API%/}"
IMPORTEUR="seed-demo"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO="$(cd "$HERE/.." && pwd)"
CSV="$HERE/demo_enveloppes.csv"

usage() {
	cat <<EOF
Usage : $(basename "$0") [--enveloppes-only] [--help]

Charge les données de démonstration dans Njord par l'API (\$API, défaut
http://localhost:8080/api ; actuel : $API).

  (sans option)       base vide attendue : importe les 6 versions du plan de charge
                      (timeline, avec leurs dates d'effet), le réalisé, les
                      provisions, puis enregistre les enveloppes par CT.
  --enveloppes-only   enregistre seulement les enveloppes de demo_enveloppes.csv
                      (PUT /enveloppes/:ct, une requête par CT ; rejouable :
                      chaque requête crée ou remplace l'enveloppe du CT, les
                      enveloppes des autres CT sont conservées).
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

# csv_enveloppes : lit demo_enveloppes.csv (niveau;code;descriptif;date_debut;
# date_fin;prevision_solde;cout_encouru;cout_previsionnel, dates AAAA-MM-JJ) et
# écrit une ligne « CT<tab>corps JSON » par enveloppe. Niveau 0 = catégorie :
# son libellé (descriptif) s'applique aux CT qui suivent. Montant = coût
# prévisionnel. Lignes ignorées (sur stderr), comme l'ancien import : période
# manquante, fin avant début, montant invalide, CT en double.
csv_enveloppes() {
	awk -F';' -v op="$IMPORTEUR" '
	function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
	function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
	function skip(motif) { printf "  ignoré  %-12s %s\n", ct, motif > "/dev/stderr" }
	{ sub(/\r$/, "") }
	NR == 1 || $0 ~ /^[ \t]*$/ { next }
	{
		niveau = trim($1); ct = trim($2); lib = trim($3)
		debut = trim($4); fin = trim($5); montant = trim($8)
		if (niveau == "0") { categ = lib; next }
		if (ct == "") next
		if (debut == "" || fin == "") { skip("Période manquante"); next }
		if (fin < debut) { skip("Fin avant début"); next }
		if (montant !~ /^[0-9]+([.][0-9]+)?$/) { skip("Montant invalide"); next }
		if (ct in vu) { skip("CT en double"); next }
		vu[ct] = 1
		printf "%s\t{\"date_debut\":\"%s\",\"date_fin\":\"%s\",\"montant\":%s,\"categorie\":\"%s\",\"operateur\":\"%s\"}\n",
			ct, debut, fin, montant, esc(categ), esc(op)
	}' "$CSV"
}

# Enveloppes saisies par l'API (DECISIONS n° 27) : une requête par CT.
import_enveloppes() {
	[ -f "$CSV" ] || { echo "ERREUR : fichier introuvable : $CSV" >&2; exit 1; }
	echo "Enveloppes ($(basename "$CSV"), PUT /enveloppes/:ct) :"
	local lignes n=0 ct body
	lignes="$(csv_enveloppes)"
	while IFS=$'\t' read -r ct body; do
		[ -n "$ct" ] || continue
		must PUT "/enveloppes/$ct" -H 'Content-Type: application/json' --data-binary "$body"
		n=$((n + 1))
	done <<<"$lignes"
	echo "  $n enveloppe(s) enregistrée(s)"
}

check_health
if [ "$MODE" = all ]; then
	import_all
fi
import_enveloppes
