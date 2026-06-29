import unittest


class AdsConversionMergeTest(unittest.TestCase):
    def test_keyword_df_prefers_ad_conversion_for_conv_and_revenue(self) -> None:
        """
        AD 리포트의 convCnt/convAmt는 UI와 정의가 달라 과대계상될 수 있어,
        AD_CONVERSION 리포트의 (convCnt/convAmt)로 전환수/전환매출을 맞춘다.
        또한 purchase 전환은 총전환과 별도로 분리 저장할 수 있어야 한다.
        """
        from main import _rows_to_keyword_df

        # AD(키워드 성과) row 1개 (convCnt는 일부러 이상한 값으로 둠)
        kw_rows = [
            {
                "statDt": "20260110",
                "campaignId": "cmp-1",
                "adgroupId": "grp-1",
                "keywordId": "kwd-1",
                "device": "M",
                "impCnt": 1000,
                "clkCnt": 10,
                "salesAmt": 5000,  # cost(ex VAT) => 5,500원(VAT 포함)
                "roas": 0.0,
                "convCnt": 9999,  # 잘못된 값(무시 기대)
                "convAmt": 0,
            }
        ]

        # AD_CONVERSION row 2개(타입별)
        conv_rows = [
            {
                "statDt": "20260110",
                "campaignId": "cmp-1",
                "adgroupId": "grp-1",
                "keywordId": "kwd-1",
                "device": "M",
                "convType": "add_to_cart",
                "convCnt": 1,
                "convAmt": 0,
            },
            {
                "statDt": "20260110",
                "campaignId": "cmp-1",
                "adgroupId": "grp-1",
                "keywordId": "kwd-1",
                "device": "M",
                "convType": "purchase",
                "convCnt": 2,
                "convAmt": 20000,
            },
        ]

        df = _rows_to_keyword_df(
            "2026-01-10",
            kw_rows,
            campaign_name_map={"cmp-1": "CAMP1"},
            adgroup_name_map={"grp-1": "GRP1"},
            keyword_meta_map={"kwd-1": {"keyword": "헤나", "campaignName": "CAMP1", "adgroupName": "GRP1"}},
            conversion_rows=conv_rows,
        )

        self.assertEqual(len(df), 1)
        row0 = df.iloc[0].to_dict()
        self.assertEqual(str(row0.get("키워드")), "헤나")
        self.assertEqual(int(row0.get("총비용(원)") or 0), 5500)
        self.assertEqual(int(row0.get("전환수") or 0), 3)
        self.assertEqual(int(row0.get("전환매출액(원)") or 0), 20000)
        self.assertEqual(int(row0.get("구매전환수") or 0), 2)
        self.assertEqual(int(row0.get("구매전환매출액(원)") or 0), 20000)


if __name__ == "__main__":
    unittest.main()

