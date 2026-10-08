// write builds the provisions workbook (format Planisware « Dépenses prévues »)
// from JSON specs:
//
//	[{"path": "...", "rows": [[cell, ...], ...], "levels": [0, 0, 0, 0, 1, ...],
//	  "date_cols": [6, 7], "money_cols": [2, 11], "date_from": 4}]
//
// Adapted from test_data_demo/timeline/generateur/write/main.go: the date
// columns apply to the 12-cell data rows (G, H), group rows are merged A:L,
// header / group / Somme rows are bold and rows carry their outline level.
package main

import (
	"encoding/json"
	"os"

	"github.com/xuri/excelize/v2"
)

type spec struct {
	Path      string  `json:"path"`
	Rows      [][]any `json:"rows"`
	Levels    []int   `json:"levels"`     // niveau de plan (outline) par ligne, 0 = aucun
	DateCols  []int   `json:"date_cols"`  // colonnes (0-based) portant des numéros de série de date
	MoneyCols []int   `json:"money_cols"` // colonnes (0-based) de montants
	DateFrom  int     `json:"date_from"`  // première ligne (1-based) portant des données
}

// isGroup: only column A is filled (project or sub-project row).
func isGroup(row []any) bool {
	if len(row) == 0 {
		return false
	}
	if s, ok := row[0].(string); !ok || s == "" || s == "Somme" {
		return false
	}
	for _, v := range row[1:] {
		if s, ok := v.(string); v != nil && (!ok || s != "") {
			return false
		}
	}
	return true
}

func main() {
	var specs []spec
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	if err := json.Unmarshal(data, &specs); err != nil {
		panic(err)
	}
	for _, s := range specs {
		f := excelize.NewFile()
		sheet := "Style par défaut"
		f.SetSheetName("Sheet1", sheet)
		fmtDate := "dd/mm/yy"
		fmtMoney := "#,##0.00"
		dateStyle, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &fmtDate})
		moneyStyle, _ := f.NewStyle(&excelize.Style{CustomNumFmt: &fmtMoney})
		bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
		boldMoney, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, CustomNumFmt: &fmtMoney})
		cell := func(c, r int) string {
			name, _ := excelize.CoordinatesToCellName(c, r)
			return name
		}
		for i, row := range s.Rows {
			r := i + 1
			if err := f.SetSheetRow(sheet, cell(1, r), &row); err != nil {
				panic(err)
			}
			if i < len(s.Levels) && s.Levels[i] > 0 {
				f.SetRowOutlineLevel(sheet, r, uint8(s.Levels[i]))
			}
			if r < s.DateFrom {
				if r == s.DateFrom-1 { // en-tête
					f.SetCellStyle(sheet, cell(1, r), cell(max(len(row), 1), r), bold)
				}
				continue
			}
			somme := len(row) > 0 && row[0] == "Somme"
			switch {
			case isGroup(row):
				f.SetCellStyle(sheet, cell(1, r), cell(len(row), r), bold)
				f.MergeCell(sheet, cell(1, r), cell(len(row), r))
			case somme:
				f.SetCellStyle(sheet, cell(1, r), cell(len(row), r), bold)
				for _, c := range s.MoneyCols {
					f.SetCellStyle(sheet, cell(c+1, r), cell(c+1, r), boldMoney)
				}
			case len(row) == 12:
				for _, c := range s.DateCols {
					f.SetCellStyle(sheet, cell(c+1, r), cell(c+1, r), dateStyle)
				}
				for _, c := range s.MoneyCols {
					f.SetCellStyle(sheet, cell(c+1, r), cell(c+1, r), moneyStyle)
				}
			}
		}
		// Bandeau : A1:D1 (date), E1:H1 (titre), I1:L1 (utilisateur), comme l'export réel.
		f.MergeCell(sheet, "A1", "D1")
		f.MergeCell(sheet, "E1", "H1")
		f.MergeCell(sheet, "I1", "L1")
		f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 3, TopLeftCell: "A4", ActivePane: "bottomLeft"})
		f.SetColWidth(sheet, "A", "A", 34)
		f.SetColWidth(sheet, "B", "B", 52)
		f.SetColWidth(sheet, "C", "C", 16)
		f.SetColWidth(sheet, "D", "D", 9)
		f.SetColWidth(sheet, "E", "E", 34)
		f.SetColWidth(sheet, "F", "L", 14)
		if err := f.SaveAs(s.Path); err != nil {
			panic(err)
		}
	}
}
