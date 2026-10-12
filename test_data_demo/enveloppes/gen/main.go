// gen écrit le classeur de démo des enveloppes par CT (demo_cat.xlsx) au format
// exact de l'export Planisware « CàT par CT » (DECISIONS n° 18), à partir de
// demo_enveloppes.csv, une ligne du CSV par ligne de la feuille :
//
//	niveau;code;descriptif;date_debut;date_fin;prevision_solde;cout_encouru;cout_previsionnel
//
// niveau 0 = catégorie (code en …00, sans dates), 1 = CT. Dates AAAA-MM-JJ
// (vides = ligne sans période). Montants recopiés tels quels quand ils sont
// renseignés ; vides : catégorie = Σ de ses CT, CT : G = 0, F = max(H − G, 0).
//
// Le classeur n'est pas écrit par une bibliothèque mais reproduit le texte de
// l'export : mêmes 12 parties dans le même ordre, mêmes en-têtes zip, mêmes
// styles (s=1…10), espaces, noms définis (EXID par ligne, ATT_*), jusqu'à la
// balise <pargeMargins> mal orthographiée de l'export. Les parties sans données
// (styles, thème, relations, types) sont copiées de l'export dans template/.
// Les EXID, le ts et le GUID de customXml sont dérivés du contenu (sha256) :
// une régénération donne le même fichier.
//
// Lancement (bibliothèque standard seule) :
//
//	cd backend && go run ../test_data_demo/enveloppes/gen/main.go
//
// Options : -csv, -out (défaut : dossier parent de ce fichier source), -date
// (date d'extraction jj/mm/aa, cellule A1) et -user (login, cellule G1).
package main

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/csv"
	"encoding/hex"
	"flag"
	"fmt"
	"hash/crc32"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed template/*.xml
var tmpl embed.FS

const sheetName = "Activité sans archive"

var header = []string{
	"Nom", "Descriptif", "Calendrier",
	"Date de début Contrôles de mouvement", "Date de fin Contrôles de mouvement",
	"Prévision pour solde", "Coût encouru", "Coût prévisionnel", "Bloc note",
}

// Noms définis des colonnes A…I (attributs Planisware).
var attNames = []string{
	"ATT_NAME", "ATT_COMMENT", "ATT_CALENDAR", "ATT_X_FN_D_ACT_CM_DD", "ATT_X_FN_D_ACT_CM_DF",
	"ATT_ESTIMATE_TO_COMPLETE", "ATT_INCURRED_EXPENDITURE", "ATT_PREDICTED_COST", "ATT_NOTE_PAD",
}

// ligne : une ligne de données de la feuille (catégorie ou CT).
type ligne struct {
	niveau     int
	code, desc string
	debut, fin string // numéros de série Excel, '' = sans date
	f, g, h    string // texte des montants tel qu'écrit dans <v>
}

func main() {
	_, src, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filepath.Dir(src))
	csvPath := flag.String("csv", filepath.Join(dir, "demo_enveloppes.csv"), "CSV source")
	outPath := flag.String("out", filepath.Join(dir, "demo_cat.xlsx"), "classeur écrit")
	date := flag.String("date", "05/10/26", "date d'extraction (jj/mm/aa), cellule A1")
	user := flag.String("user", "demo.njord", "login de l'utilisateur, cellule G1")
	flag.Parse()

	lignes, err := lire(*csvPath)
	if err != nil {
		fail(err)
	}
	extraction, err := time.Parse("02/01/06", *date)
	if err != nil {
		fail(fmt.Errorf("-date %q : attendu jj/mm/aa", *date))
	}
	data, err := classeur(lignes, *date, "Utilisateur "+*user, extraction.Add(10*time.Hour + 35*time.Minute + 36*time.Second))
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(*outPath, data, 0o644); err != nil {
		fail(err)
	}
	n := 0
	for _, l := range lignes {
		if l.niveau == 1 {
			n++
		}
	}
	fmt.Printf("%s : %d lignes (%d CT)\n", *outPath, len(lignes), n)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "gen:", err)
	os.Exit(1)
}

// lire charge le CSV et complète les montants vides.
func lire(path string) ([]ligne, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.Comma = ';'
	recs, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(recs) < 2 || strings.Join(recs[0], ";") != "niveau;code;descriptif;date_debut;date_fin;prevision_solde;cout_encouru;cout_previsionnel" {
		return nil, fmt.Errorf("%s : en-tête inattendu", path)
	}
	var out []ligne
	for i, rec := range recs[1:] {
		n := i + 2
		l := ligne{code: rec[1], desc: rec[2], f: rec[5], g: rec[6], h: rec[7]}
		switch rec[0] {
		case "0":
			l.niveau = 0
		case "1":
			l.niveau = 1
		default:
			return nil, fmt.Errorf("ligne %d : niveau %q (0 ou 1)", n, rec[0])
		}
		for _, d := range []struct {
			in  string
			out *string
		}{{rec[3], &l.debut}, {rec[4], &l.fin}} {
			if d.in == "" {
				continue
			}
			t, err := time.Parse("2006-01-02", d.in)
			if err != nil {
				return nil, fmt.Errorf("ligne %d : date %q", n, d.in)
			}
			*d.out = strconv.Itoa(int(t.Sub(time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)).Hours() / 24))
		}
		for _, v := range []string{l.f, l.g, l.h} {
			if _, err := num(v); err != nil {
				return nil, fmt.Errorf("ligne %d : montant %q", n, v)
			}
		}
		if l.niveau == 1 {
			if l.g == "" {
				l.g = "0"
			}
			if l.h == "" {
				l.h = "0"
			}
			if l.f == "" {
				h, _ := num(l.h)
				g, _ := num(l.g)
				l.f = fmtNum(math.Max(h-g, 0))
			}
		}
		out = append(out, l)
	}
	// Catégories : montants vides = Σ des CT qui suivent jusqu'à la prochaine.
	for i := range out {
		if out[i].niveau != 0 {
			continue
		}
		var sf, sg, sh float64
		for j := i + 1; j < len(out) && out[j].niveau == 1; j++ {
			f, _ := num(out[j].f)
			g, _ := num(out[j].g)
			h, _ := num(out[j].h)
			sf, sg, sh = sf+f, sg+g, sh+h
		}
		for _, p := range []struct {
			v *string
			s float64
		}{{&out[i].f, sf}, {&out[i].g, sg}, {&out[i].h, sh}} {
			if *p.v == "" {
				*p.v = fmtNum(p.s)
			}
		}
	}
	return out, nil
}

func num(s string) (float64, error) {
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

func fmtNum(v float64) string {
	return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64)
}

// sst : table des chaînes partagées (uniques, ordre de première apparition).
type sst struct {
	idx   map[string]int
	list  []string
	count int
}

func (s *sst) ref(v string) int {
	s.count++
	if i, ok := s.idx[v]; ok {
		return i
	}
	s.idx[v] = len(s.list)
	s.list = append(s.list, v)
	return len(s.list) - 1
}

func esc(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func col(i int) string { return string(rune('A' + i)) }

// feuille écrit sheet1.xml et la table des chaînes, au texte près de l'export.
func feuille(lignes []ligne, date, user string) (sheet, strs []byte) {
	s := &sst{idx: map[string]int{}}
	var b bytes.Buffer
	str := func(ref string, style, v string) {
		fmt.Fprintf(&b, `<c r="%s" s="%s" t="s">  <v>%d</v></c>`, ref, style, s.ref(v))
	}
	b.WriteString(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac">
<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>
<dimension ref="A1:I10" /><sheetViews>
  <sheetView workbookViewId="0"><pane ySplit="3"  topLeftCell="A4" state="frozenSplit"/>  </sheetView>
</sheetViews>
<sheetFormatPr baseColWidth="10" defaultRowHeight="15.0" />
<cols><col min="1" max="1" width="29.684849" bestFit="1" customWidth="1"/><col min="2" max="2" width="62.75152" bestFit="1" customWidth="1"/><col min="3" max="3" width="13.715152" bestFit="1" customWidth="1"/><col min="4" max="4" width="54.67273" bestFit="1" customWidth="1"/><col min="5" max="5" width="49.224243" bestFit="1" customWidth="1"/><col min="6" max="6" width="31.563637" bestFit="1" customWidth="1"/><col min="7" max="7" width="19.163637" bestFit="1" customWidth="1"/><col min="8" max="8" width="23.29697" bestFit="1" customWidth="1"/><col min="9" max="9" width="63.127274" bestFit="1" customWidth="1"/></cols>
<sheetData>
`)
	// Ligne 1 : date d'extraction, « Tableau », utilisateur (fusionnés par trois).
	b.WriteString("<row r=\"1\" spans=\"1:9\">\n")
	bandeau := map[int]string{0: date, 3: "Tableau", 6: user}
	for i := 0; i < 9; i++ {
		str(col(i)+"1", "1", bandeau[i])
	}
	b.WriteString("</row>\n")
	// Ligne 3 : en-tête.
	b.WriteString("<row r=\"3\" spans=\"1:9\" outlineLevel=\"0\">\n")
	for i, h := range header {
		str(col(i)+"3", "2", h)
	}
	b.WriteString("</row>\n")
	// Données : catégories (styles 3-6) et CT (styles 7-10).
	for k, l := range lignes {
		r := k + 4
		sA, sTxt, sVide, sDate, sNum := "3", "3", "4", "5", "6"
		if l.niveau == 1 {
			sA, sTxt, sVide, sDate, sNum = "7", "7", "7", "8", "9"
			if l.debut != "" {
				sA = "10" // CT ouvert (contrôle de mouvement daté)
			}
		}
		fmt.Fprintf(&b, "<row r=\"%d\" spans=\"1:9\" ht=\"18.0\" customHeight=\"1\" outlineLevel=\"%d\">\n", r, l.niveau)
		str(fmt.Sprintf("A%d", r), sA, l.code)
		str(fmt.Sprintf("B%d", r), sTxt, l.desc)
		str(fmt.Sprintf("C%d", r), sVide, "")
		for i, d := range []string{l.debut, l.fin} {
			if d == "" {
				fmt.Fprintf(&b, "<c r=\"%s%d\" s=\"%s\"/>\n", col(3+i), r, sDate)
			} else {
				fmt.Fprintf(&b, `  <c r="%s%d" s="%s" ><v>%s</v></c>`, col(3+i), r, sDate, d)
			}
		}
		for i, v := range []string{l.f, l.g, l.h} {
			fmt.Fprintf(&b, `  <c r="%s%d" s="%s" ><v>%s</v></c>`, col(5+i), r, sNum, v)
		}
		str(fmt.Sprintf("I%d", r), sVide, "")
		b.WriteString("</row>\n")
	}
	b.WriteString(`  </sheetData>
<mergeCells count="3"><mergeCell ref="G1:I1"/>
<mergeCell ref="D1:F1"/>
<mergeCell ref="A1:C1"/>
</mergeCells>
<pargeMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>
`)
	var t bytes.Buffer
	fmt.Fprintf(&t, `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">`, s.count, len(s.list))
	for _, v := range s.list {
		fmt.Fprintf(&t, `<si><t xml:space="preserve">%s</t></si>`, esc(v))
	}
	t.WriteString(`</sst>`)
	return b.Bytes(), t.Bytes()
}

// exid : identifiant Planisware d'une ligne, dérivé de son code.
func exid(code string) string {
	h := sha256.Sum256([]byte("EXID|" + code))
	return fmt.Sprintf("EXID%d_%d_%d_%d_0",
		binary.BigEndian.Uint32(h[0:]), binary.BigEndian.Uint32(h[4:]),
		binary.BigEndian.Uint32(h[8:]), binary.BigEndian.Uint32(h[12:]))
}

func workbook(lignes []ligne) []byte {
	ref := "&apos;" + sheetName + "&apos;!"
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fileVersion appName="xl" lastEdited="4" lowestEdited="4" rupBuild="4506"/>
<workbookPr filterPrivacy="1" defaultThemeVersion="124226"/>
<bookViews>
<workbookView xWindow="480" yWindow="300" windowWidth="18495" windowHeight="11700" activeTab="1"/>
</bookViews>
<sheets>
<sheet name="` + sheetName + `" sheetId="1" state="visible" r:id="rId1"/>
</sheets>
<definedNames>
<definedName name="opx_version" hidden="1">2</definedName>
`)
	name := func(n, target string) {
		fmt.Fprintf(&b, "<definedName name=\"%s\" localSheetId=\"0\">%s%s</definedName>\n", n, ref, target)
	}
	for k, l := range lignes {
		name(exid(l.code), fmt.Sprintf("$%d:$%d", k+4, k+4))
	}
	name("NO_IMPORT1", "$1:$1")
	for i, n := range attNames {
		name(n, fmt.Sprintf("$%s:$%s", col(i), col(i)))
	}
	name("NO_IMPORT2", "$3:$3")
	name("_xlnm.Print_Titles", "1:3")
	b.WriteString("</definedNames>\n<calcPr calcId=\"125725\"/>\n</workbook>\n")
	return b.Bytes()
}

func classeur(lignes []ligne, date, user string, modif time.Time) ([]byte, error) {
	sheet, strs := feuille(lignes, date, user)
	sum := sha256.Sum256(append(append([]byte{}, sheet...), strs...))
	g := sha256.Sum256(append([]byte("itemID|"), sum[:]...))
	guid := hex.EncodeToString(g[:16])
	guid = guid[0:8] + "-" + guid[8:12] + "-" + guid[12:16] + "-" + guid[16:20] + "-" + guid[20:32]

	part := func(name string) []byte {
		data, err := tmpl.ReadFile("template/" + name)
		if err != nil {
			panic(err)
		}
		return data
	}
	parts := []struct {
		name string
		data []byte
	}{
		{"customXml/_rels/item1.xml.rels", part("item1_rels.xml")},
		{"customXml/itemProps1.xml", []byte(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="` + guid + `" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`)},
		{"customXml/item1.xml", []byte("<opx2-data>\n<ts>" + hex.EncodeToString(sum[:]) + "</ts>\n</opx2-data>\n")},
		{"_rels/.rels", part("rels.xml")},
		{"docProps/core.xml", part("core.xml")},
		{"xl/_rels/workbook.xml.rels", part("workbook_rels.xml")},
		{"xl/theme/theme1.xml", part("theme1.xml")},
		{"xl/worksheets/sheet1.xml", sheet},
		{"xl/styles.xml", part("styles.xml")},
		{"xl/sharedStrings.xml", strs},
		{"xl/workbook.xml", workbook(lignes)},
		{"[Content_Types].xml", part("content_types.xml")},
	}

	// En-têtes zip de l'export : Deflate, version 2.0 (MS-DOS), pas de
	// descripteur de données ni d'extra, attributs externes 0x1800000.
	d, t := msDos(modif)
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, p := range parts {
		var comp bytes.Buffer
		fw, err := flate.NewWriter(&comp, flate.DefaultCompression)
		if err != nil {
			return nil, err
		}
		fw.Write(p.data)
		fw.Close()
		w, err := zw.CreateRaw(&zip.FileHeader{
			Name:               p.name,
			Method:             zip.Deflate,
			CreatorVersion:     20,
			ReaderVersion:      20,
			ModifiedDate:       d,
			ModifiedTime:       t,
			ExternalAttrs:      0x1800000,
			CRC32:              crc32.ChecksumIEEE(p.data),
			CompressedSize64:   uint64(comp.Len()),
			UncompressedSize64: uint64(len(p.data)),
		})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(comp.Bytes()); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func msDos(t time.Time) (date, tm uint16) {
	date = uint16(t.Day() + int(t.Month())<<5 + (t.Year()-1980)<<9)
	tm = uint16(t.Second()/2 + t.Minute()<<5 + t.Hour()<<11)
	return
}
