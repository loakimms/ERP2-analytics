import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from fastapi import HTTPException

from db import Base, TrackedCompetitorProduct
from main import MAX_COMPETITORS_PER_TRACKED, ensure_competitor_limit


class EnsureCompetitorLimitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        # SQLite에서는 Postgres 전용 server_default(now()) 등이 섞인 테이블 생성이 실패할 수 있어
        # 이 테스트에 필요한 테이블만 생성한다.
        Base.metadata.create_all(self.engine, tables=[TrackedCompetitorProduct.__table__])
        self.SessionLocal = sessionmaker(bind=self.engine)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _session(self) -> Session:
        return self.SessionLocal()

    def test_allows_when_under_limit(self) -> None:
        tracked_id = 1
        with self._session() as db:
            # 기존 1개만 등록
            db.add(
                TrackedCompetitorProduct(
                    tracked_keyword_id=tracked_id,
                    name="경쟁A",
                    match_text="경쟁A",
                    is_active=True,
                )
            )
            db.commit()

            # 새로 2개 추가 → 기본 한도(3) 이내
            ensure_competitor_limit(
                db,
                tracked_keyword_id=tracked_id,
                new_count=2,
                max_competitors=MAX_COMPETITORS_PER_TRACKED,
            )

    def test_raises_when_exceeds_limit(self) -> None:
        tracked_id = 2
        with self._session() as db:
            # 이미 3개 모두 활성화 상태
            for i in range(3):
                db.add(
                    TrackedCompetitorProduct(
                        tracked_keyword_id=tracked_id,
                        name=f"경쟁{i}",
                        match_text=f"브랜드{i}",
                        is_active=True,
                    )
                )
            db.commit()

            with self.assertRaises(HTTPException) as ctx:
                ensure_competitor_limit(
                    db,
                    tracked_keyword_id=tracked_id,
                    new_count=1,
                    max_competitors=MAX_COMPETITORS_PER_TRACKED,
                )

            exc = ctx.exception
            self.assertEqual(exc.status_code, 400)
            self.assertIn("최대", exc.detail)


if __name__ == "__main__":
    unittest.main()


