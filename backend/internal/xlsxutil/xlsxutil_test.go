package xlsxutil

import (
	"os"
	"testing"
)

func TestHelpers(t *testing.T) {
	if NormHeader("n° COMMANDE") != "n commande" || NormHeader(".PPS") != "pps" || NormHeader("Tâche ou sous-projet") != "tache ou sous projet" {
		t.Error("NormHeader")
	}
	if d, _ := ParseDate("46266"); d != "2026-09-01" {
		t.Error("serial", d)
	}
	if d, _ := ParseDate("46112.9999"); d != "2026-04-01" {
		t.Error("float serial", d)
	}
	if v, _ := ParseNumber("-61 800,5"); v != -61800.5 {
		t.Error("number", v)
	}
	if c, _ := CodeAndLabel("Y99F90001 - Alpha Core Team"); c != "Y99F90001" {
		t.Error("code")
	}
}

func TestFindTableDemo(t *testing.T) {
	data, err := os.ReadFile("../../../test_data_demo/demo_plancharge.xlsx")
	if err != nil {
		t.Skip("demo file missing")
	}
	tb, err := FindTable(data, []string{"Plan de charge"}, 20, func(r []string) bool {
		return IndexOf(r, "tache ou sous projet") == 0 && IndexOf(r, "ressource") == 1
	})
	if err != nil {
		t.Fatal(err)
	}
	if tb.HeaderRow != 3 || tb.Sheet != "Style par défaut" || len(tb.Rows) != 52 {
		t.Fatalf("got sheet %q header %d rows %d", tb.Sheet, tb.HeaderRow, len(tb.Rows))
	}
}
