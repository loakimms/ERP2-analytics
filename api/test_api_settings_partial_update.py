import unittest


class ApiSettingsPartialUpdateTest(unittest.TestCase):
    def test_partial_put_does_not_wipe_other_keys(self) -> None:
        """
        유효성 검사 버튼에서 특정 키만 PUT 하는 경우가 있어,
        부분 업데이트가 다른 저장값을 삭제하면 안 된다.
        """
        # IMPORTANT:
        # - FastAPI TestClient를 쓰면 실제 Postgres(app_settings)에 기록될 수 있다.
        # - 운영/로컬 DB 오염을 막기 위해 sqlite 인메모리로 settings_store만 단위 테스트한다.
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        from db import Base, AppSetting
        from settings_store import get_api_settings, save_api_settings

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine, tables=[AppSetting.__table__])
        SessionLocal = sessionmaker(bind=engine)

        with SessionLocal() as db:
            # 1) 먼저 2개 저장
            save_api_settings(db, {"NAVER_KEY": "k1", "NAVER_SECRET": "s1"})

        with SessionLocal() as db:
            # 2) OPENAI_API_KEY만 부분 업데이트
            save_api_settings(db, {"OPENAI_API_KEY": "sk-test"})

        with SessionLocal() as db:
            # 3) 기존 값이 유지되어야 한다
            data = get_api_settings(db, ["NAVER_KEY", "NAVER_SECRET", "OPENAI_API_KEY"])
            self.assertEqual(data.get("NAVER_KEY"), "k1")
            self.assertEqual(data.get("NAVER_SECRET"), "s1")
            self.assertEqual(data.get("OPENAI_API_KEY"), "sk-test")

        engine.dispose()


if __name__ == "__main__":
    unittest.main()

