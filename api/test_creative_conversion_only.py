import unittest


from main import _rows_to_creative_df


class CreativeConversionOnlyTest(unittest.TestCase):
    def test_conversion_only_row_is_included_even_when_ad_rows_empty(self) -> None:
        df = _rows_to_creative_df(
            "2026-01-12",
            [],
            campaign_name_map={"c1": "#SA_파워링크_MO_0819"},
            adgroup_name_map={"g1": "1_순위_MO"},
            ads_meta_map={"a1": {"name": "테스트 소재"}},
            conversion_rows=[
                {
                    "campaignId": "c1",
                    "adgroupId": "g1",
                    "nadId": "a1",
                    "device": "PC",
                    "convType": "purchase",
                    "convCnt": 2,
                    "convAmt": 12345,
                }
            ],
        )

        self.assertEqual(len(df), 1)
        row = df.iloc[0].to_dict()
        self.assertEqual(int(row.get("노출수") or 0), 0)
        self.assertEqual(int(row.get("클릭수") or 0), 0)
        self.assertEqual(int(row.get("총비용(원)") or 0), 0)
        self.assertEqual(int(row.get("전환수") or 0), 2)
        self.assertEqual(int(row.get("전환매출액(원)") or 0), 12345)
        self.assertEqual(int(row.get("구매전환수") or 0), 2)
        self.assertEqual(int(row.get("구매전환매출액(원)") or 0), 12345)


if __name__ == "__main__":
    unittest.main()

