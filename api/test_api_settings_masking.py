import unittest

from fastapi.testclient import TestClient

import main
from db import AppSetting, SessionLocal, init_db
from settings_store import save_api_settings


class ApiSettingsMaskingTest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        self.client = TestClient(main.app)
        with SessionLocal() as db:
            db.query(AppSetting).filter(AppSetting.key.like("api:%")).delete(synchronize_session=False)
            db.commit()

    def test_get_settings_masks_sensitive_values(self) -> None:
        with SessionLocal() as db:
            save_api_settings(
                db,
                {
                    "AD_CUST_ID": "1053378",
                    "NAVER_KEY": "naver-key",
                    "NAVER_SECRET": "naver-secret",
                    "NAVER_COMMERCE_CLIENT_ID": "commerce-id",
                    "NAVER_COMMERCE_CLIENT_SECRET": "$2a$10$abcdefghijklmnopqrstuv",
                    "OPENAI_API_KEY": "sk-test-secret",
                },
            )

        res = self.client.get("/settings/api")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["AD_CUST_ID"], "1053378")
        self.assertEqual(data["NAVER_KEY"], "********")
        self.assertEqual(data["NAVER_SECRET"], "********")
        self.assertEqual(data["NAVER_COMMERCE_CLIENT_ID"], "********")
        self.assertEqual(data["NAVER_COMMERCE_CLIENT_SECRET"], "********")
        self.assertEqual(data["OPENAI_API_KEY"], "********")


if __name__ == "__main__":
    unittest.main()
