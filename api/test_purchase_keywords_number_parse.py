import unittest


class PurchaseKeywordsNumberParseTest(unittest.TestCase):
    def test_first_number_parse_does_not_turn_into_zero(self) -> None:
        """
        스마트스토어 엑셀/CSV에서 한 셀에 "값 (비율%)" 형태로 들어올 수 있다.
        예: "1 (0.0%)", "90,879 (64.7%)"

        과거 로직처럼 숫자/점만 남기면 "1.00.0" 같은 문자열이 되어 0으로 저장될 수 있어
        결제수/결제금액 합계가 누락되는 문제가 발생했다.
        """
        import math
        import re

        def first_number(v: object) -> float | None:
            try:
                if v is None:
                    return None
                if isinstance(v, bool):
                    return float(int(v))
                if isinstance(v, (int, float)):
                    return float(v)
                s = str(v).strip()
                if not s:
                    return None
                s = s.replace(",", "")
                m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
                if not m:
                    return None
                n = float(m.group(0))
                return n if math.isfinite(n) else None
            except Exception:
                return None

        self.assertEqual(int(first_number("1 (0.0%)") or 0), 1)
        self.assertEqual(int(first_number("0 (0.0%)") or 0), 0)
        self.assertEqual(int(first_number("90,879 (64.7%)") or 0), 90879)
        self.assertEqual(int(first_number("70,000") or 0), 70000)
        self.assertEqual(int(first_number("  28,000원 ") or 0), 28000)
        self.assertEqual(first_number(""), None)
        self.assertEqual(first_number("-"), None)

    def test_round_half_up_matches_excel_display(self) -> None:
        import math
        import re

        def first_number(v: object) -> float | None:
            try:
                if v is None:
                    return None
                if isinstance(v, bool):
                    return float(int(v))
                if isinstance(v, (int, float)):
                    return float(v)
                s = str(v).strip()
                if not s:
                    return None
                s = s.replace(",", "")
                m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
                if not m:
                    return None
                n = float(m.group(0))
                return n if math.isfinite(n) else None
            except Exception:
                return None

        def round_half_up(n: float) -> int:
            if not math.isfinite(float(n)):
                return 0
            if n >= 0:
                return int(math.floor(n + 0.5))
            return int(math.ceil(n - 0.5))

        self.assertEqual(round_half_up(first_number("0.4") or 0.0), 0)
        self.assertEqual(round_half_up(first_number("0.5") or 0.0), 1)
        self.assertEqual(round_half_up(first_number("0.6 (12.3%)") or 0.0), 1)
        self.assertEqual(round_half_up(first_number("1.4") or 0.0), 1)
        self.assertEqual(round_half_up(first_number("1.5") or 0.0), 2)


if __name__ == "__main__":
    unittest.main()

