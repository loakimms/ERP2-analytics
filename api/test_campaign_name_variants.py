import unittest


from main import _expand_campaign_names


class CampaignNameVariantsTest(unittest.TestCase):
    def test_expand_campaign_names_handles_leading_hash(self) -> None:
        vs = _expand_campaign_names({"SA_파워링크_MO_0819"})
        self.assertIn("SA_파워링크_MO_0819", vs)
        self.assertIn("#SA_파워링크_MO_0819", vs)

        vs2 = _expand_campaign_names({"#SA_파워링크_MO_0819"})
        self.assertIn("SA_파워링크_MO_0819", vs2)
        self.assertIn("#SA_파워링크_MO_0819", vs2)


if __name__ == "__main__":
    unittest.main()

