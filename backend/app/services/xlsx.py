"""Denetim formatında Excel: "Rapor Bilgisi" + veri sayfası."""
from datetime import datetime
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from ..i18n import t as _t
from ..schemas import Column

HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(bold=True, color="FFFFFF")
ROW_LINE = Border(bottom=Side(style="thin", color="BFBFBF"))


def _sheet_name(s: str) -> str:
    for ch in '[]:*?/\\':
        s = s.replace(ch, " ")
    return s[:31]


def build_workbook(path: Path, title: str, meta: list[tuple[str, object]], cols: list[Column],
                   table: list[list], fills: list[str | None], sheet_title: str):
    wb = openpyxl.Workbook()
    info = wb.active
    info.title = _t("Rapor Bilgisi")
    for i, (k, v) in enumerate(meta, 1):
        a = info.cell(i, 1, k)
        a.font = Font(bold=True, color="C00000" if k == _t("UYARI") else None)
        a.alignment = Alignment(vertical="top")
        info.cell(i, 2, v).alignment = Alignment(wrap_text=True, vertical="top")
    info.column_dimensions["A"].width = 26
    info.column_dimensions["B"].width = 110

    ws = wb.create_sheet(_sheet_name(sheet_title))
    for c, col in enumerate(cols, 1):
        x = ws.cell(1, c, col.label)
        x.font, x.fill = HEADER_FONT, HEADER_FILL
        x.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = col.width
    for r, (row, fill) in enumerate(zip(table, fills), 2):
        pf = PatternFill("solid", fgColor=fill) if fill else None
        for c, v in enumerate(row, 1):
            x = ws.cell(r, c, v)
            x.border = ROW_LINE
            x.alignment = Alignment(vertical="top", wrap_text=isinstance(v, str) and "\n" in v)
            if isinstance(v, datetime):
                x.number_format = "dd.mm.yyyy hh:mm:ss"
            if pf:
                x.fill = pf
    last = get_column_letter(max(len(cols), 1))
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = f"A1:{last}{max(len(table) + 1, 2)}"
    ws.row_dimensions[1].height = 32
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:1"
    ws.oddHeader.center.text = title
    ws.oddFooter.center.text = _t("Sayfa &P / &N")
    wb.active = 1
    wb.save(path)
