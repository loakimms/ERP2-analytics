import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db import Base, TrackedProductKeyword
from main import MAX_KEYWORDS_PER_PRODUCT, ensure_product_keyword_limit
from fastapi import HTTPException


class EnsureProductKeywordLimitTest(unittest.TestCase):
    def setUp(self) -> None:
        # SQLite 인메모리 DB 를 사용해 TrackedProductKeyword 테이블만 생성한다.
        self.engine = create_engine("sqlite:///:memory:")
        # SQLite에서는 Postgres 전용 server_default(now()) 등이 섞인 테이블 생성이 실패할 수 있어
        # 이 테스트에 필요한 테이블만 생성한다.
        Base.metadata.create_all(self.engine, tables=[TrackedProductKeyword.__table__])
        self.SessionLocal = sessionmaker(bind=self.engine)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_session(self) -> Session:
        return self.SessionLocal()

    def test_allows_when_total_under_max(self) -> None:
        """현재 개수 + 신규 개수가 최대 한도 이하이면 예외가 발생하지 않는다."""
        url = "https://shopping.naver.com/item/123"

        with self._create_session() as db:
            # 기존 10개 등록
            for i in range(10):
                db.add(
                    TrackedProductKeyword(
                        product_url=url,
                        keyword=f"키워드{i}",
                        is_active=True,
                    )
                )
            db.commit()

            # 새로 5개를 추가하려고 할 때, 기본 한도(30)를 넘지 않으므로 허용되어야 한다.
            ensure_product_keyword_limit(
                db,
                product_url=url,
                new_keywords_count=5,
                max_keywords=MAX_KEYWORDS_PER_PRODUCT,
            )

    def test_does_not_raise_when_exceeds_max(self) -> None:
        """(요청) 키워드 한도 제한 제거: 한도를 초과해도 예외를 발생시키지 않는다."""
        url = "https://shopping.naver.com/item/456"

        with self._create_session() as db:
            # 기존 29개 등록
            for i in range(29):
                db.add(
                    TrackedProductKeyword(
                        product_url=url,
                        keyword=f"키워드{i}",
                        is_active=True,
                    )
                )
            db.commit()

            # 예외가 발생하지 않아야 한다.
            ensure_product_keyword_limit(
                db,
                product_url=url,
                new_keywords_count=2,
                max_keywords=MAX_KEYWORDS_PER_PRODUCT,
            )


if __name__ == "__main__":
    unittest.main()


