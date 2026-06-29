import unittest


class ApiSettingsCommerceKeysTest(unittest.TestCase):
    def test_api_settings_payload_and_public_keys_include_commerce(self) -> None:
        """
        커머스 API 자격증명이 'API 세팅'에서 저장/조회 가능하려면
        - ApiSettingsPayload에 필드가 존재해야 하고
        - _API_SETTINGS_PUBLIC_KEYS에 포함되어 /settings/api에서 다뤄져야 한다.
        """
        import main

        self.assertIn("NAVER_COMMERCE_CLIENT_ID", getattr(main, "_API_SETTINGS_PUBLIC_KEYS", []))
        self.assertIn(
            "NAVER_COMMERCE_CLIENT_SECRET",
            getattr(main, "_API_SETTINGS_PUBLIC_KEYS", []),
        )

        payload_cls = getattr(main, "ApiSettingsPayload")
        fields = getattr(payload_cls, "model_fields", None) or getattr(payload_cls, "__fields__", None) or {}
        self.assertIn("NAVER_COMMERCE_CLIENT_ID", fields)
        self.assertIn("NAVER_COMMERCE_CLIENT_SECRET", fields)


if __name__ == "__main__":
    unittest.main()

