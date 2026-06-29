import unittest


class ShoppingKeywordFallbackTest(unittest.TestCase):
    def test_infer_keyword_from_adgroup_name(self) -> None:
        import main

        self.assertEqual(main._infer_keyword_from_adgroup_name("#MO_염색약_천연염색약"), "염색약 천연염색약")
        self.assertEqual(main._infer_keyword_from_adgroup_name("MO_비건염색약"), "비건염색약")
        self.assertEqual(main._infer_keyword_from_adgroup_name("#PC_새치염색약"), "새치염색약")
        self.assertEqual(main._infer_keyword_from_adgroup_name("  "), None)

    def test_is_powerlink_campaign_name_text(self) -> None:
        import main

        self.assertTrue(main._is_powerlink_campaign_name_text("#SA_파워링크_MO_0819"))
        self.assertTrue(main._is_powerlink_campaign_name_text("SA_파워링크_PC"))
        self.assertFalse(main._is_powerlink_campaign_name_text("#SS01_쇼핑검색"))
        self.assertFalse(main._is_powerlink_campaign_name_text("SB01_브랜드"))


if __name__ == "__main__":
    unittest.main()

