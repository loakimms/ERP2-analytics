import os
import unittest
import uuid
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app, PRODUCT_METADATA_CACHE
from db import SessionLocal, TrackedProductMeta


class ProductMetadataApiTest(unittest.TestCase):
    def setUp(self) -> None:
        PRODUCT_METADATA_CACHE.clear()

    @patch("main._first_nonempty")
    @patch("main.requests.get")
    def test_returns_metadata_from_naver_shop_api_and_matches_product_id(
        self, mock_get: MagicMock, mock_first_nonempty: MagicMock
    ) -> None:
        # given
        # 1) URL(og) 추출은 실패하도록(og meta 없음) 만든다.
        og_resp = MagicMock()
        og_resp.status_code = 200
        og_resp.text = "<html><head></head><body>ok</body></html>"

        # 2) shop.json 응답: link 기반으로 smartstore productId 매칭이 가능해야 한다.
        shop_resp = MagicMock()
        shop_resp.status_code = 200
        shop_resp.json.return_value = {
            "items": [
                {
                    "title": "<b>헤나 염색약</b> 천연염색",
                    "image": "http://example.com/img1.jpg",
                    "mallName": "테스트몰",
                    "productId": "11043833896",
                    "link": "https://smartstore.naver.com/thesujata/products/11043833896",
                },
                {
                    "title": "<b>다른 상품</b>",
                    "image": "http://example.com/img2.jpg",
                    "mallName": "다른몰",
                    "productId": "99999999999",
                    "link": "https://smartstore.naver.com/thesujata/products/99999999999",
                },
            ]
        }

        def side_effect(url: str, *args, **kwargs):
            if "openapi.naver.com" in str(url):
                return shop_resp
            return og_resp

        mock_get.side_effect = side_effect
        mock_first_nonempty.return_value = "configured"

        client = TestClient(app)
        # when
        # DB에 이미 저장된 메타가 있으면 (테스트 외부 요청/이전 테스트 실행 등)
        # OpenAPI 호출이 발생하지 않으므로, product_url을 유니크하게 만들어 항상 네트워크(mock) 경로를 탄다.
        product_url = f"https://smartstore.naver.com/thesujata/products/11043833896?test={uuid.uuid4().hex}"
        normalized_url = product_url.split("?", 1)[0]
        with SessionLocal() as db:
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == normalized_url).delete(
                synchronize_session=False
            )
            db.commit()
        resp = client.get(
            "/search-rank/product-metadata",
            params={
                "keyword": "헤나 염색약",
                "product_url": product_url,
            },
        )

        # then
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["title"], "헤나 염색약 천연염색")
        self.assertEqual(data["image_url"], "http://example.com/img1.jpg")
        self.assertEqual(data["site_name"], "테스트몰")

    @patch("main.requests.get")
    def test_does_not_fallback_to_first_item_when_product_url_present_but_no_match(
        self, mock_get: MagicMock
    ) -> None:
        # given: og 추출 실패 + shop.json에 해당 product_url이 없으면
        #        items[0]으로 떨어지지 않고 빈 메타를 반환해야 한다(오염 방지)
        og_resp = MagicMock()
        og_resp.status_code = 200
        og_resp.text = "<html><head></head><body>ok</body></html>"

        shop_resp = MagicMock()
        shop_resp.status_code = 200
        shop_resp.json.return_value = {
            "items": [
                {
                    "title": "<b>완전 다른 상품</b>",
                    "image": "http://example.com/wrong.jpg",
                    "mallName": "다른몰",
                    "productId": "99999999999",
                    "link": "https://smartstore.naver.com/thesujata/products/99999999999",
                }
            ]
        }

        def side_effect(url: str, *args, **kwargs):
            if "openapi.naver.com" in str(url):
                return shop_resp
            return og_resp

        mock_get.side_effect = side_effect

        client = TestClient(app)

        with patch.dict(
            os.environ,
            {
                "NAVER_SEARCH_CLIENT_ID": "test-client-id",
                "NAVER_SEARCH_CLIENT_SECRET": "test-client-secret",
            },
            clear=False,
        ):
            product_url = f"https://smartstore.naver.com/thesujata/products/11043833896?test={uuid.uuid4().hex}"
            resp = client.get(
                "/search-rank/product-metadata",
                params={"keyword": "헤나 염색약", "product_url": product_url},
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNone(data["title"])
        self.assertIsNone(data["image_url"])

    @patch("main.requests.get")
    def test_returns_metadata_from_db_without_calling_naver_api(
        self, mock_get: MagicMock
    ) -> None:
        # given: DB 에 이미 메타데이터가 저장되어 있는 경우
        # smartstore URL은 오염 가능성 때문에 DB 값을 단독으로 신뢰하지 않도록 변경되었으므로,
        # 이 테스트는 '비 smartstore' URL로 DB 우선 반환을 검증한다.
        url = f"https://shopping.naver.com/item/{uuid.uuid4().hex}"
        with SessionLocal() as db:
            row = TrackedProductMeta(
                product_url=url,
                keyword="헤나 염색약",
                title="DB 저장 상품명",
                mall_name="DB몰",
                image_url="http://example.com/db.jpg",
                price=12345,
                product_id_catalog=999999999,
            )
            db.add(row)
            db.commit()

        client = TestClient(app)

        with patch.dict(
            os.environ,
            {
                "NAVER_SEARCH_CLIENT_ID": "test-client-id",
                "NAVER_SEARCH_CLIENT_SECRET": "test-client-secret",
            },
            clear=False,
        ):
            # when
            resp = client.get(
                "/search-rank/product-metadata",
                params={
                    "keyword": "헤나 염색약",
                    "product_url": url,
                },
            )

        # then
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["title"], "DB 저장 상품명")
        self.assertEqual(data["image_url"], "http://example.com/db.jpg")
        self.assertEqual(data["site_name"], "DB몰")
        self.assertEqual(data["price"], 12345)
        mock_get.assert_not_called()

    def test_when_db_meta_is_poisoned_for_smartstore_url_it_is_not_returned_as_is(self) -> None:
        """
        과거 fallback으로 인해 특정 product_url에 다른 상품 메타가 저장되어 있을 수 있다.
        smartstore URL이면 URL에서 유추한 mall_name과 DB mall_name이 다를 때
        그 값을 그대로 반환하면 UI가 '다른 상품'으로 오염된다.
        """
        url = f"https://smartstore.naver.com/thesujata/products/12874366496?test={uuid.uuid4().hex}"
        normalized_url = url.split("?", 1)[0]
        with SessionLocal() as db:
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == normalized_url).delete(
                synchronize_session=False
            )
            row = TrackedProductMeta(
                product_url=normalized_url,
                keyword="헤어팩",
                title="완전 다른 상품",
                mall_name="비에티",  # URL mall(thesujata)와 불일치
                image_url="http://example.com/wrong.jpg",
                price=37000,
                product_id_catalog=123,
            )
            db.add(row)
            db.commit()

        client = TestClient(app)
        resp = client.get(
            "/search-rank/product-metadata",
            params={"keyword": "헤어팩", "product_url": url},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # 오염된 title/image는 그대로 반환되면 안 됨
        self.assertIsNone(data["title"])
        self.assertIsNone(data["image_url"])
        # site_name은 URL에서 유추한 값(thesujata)이거나 None일 수 있다(차단/캡차 환경).
        # 중요한 건 '다른 상품명/이미지'로 오염되지 않는 것.
        self.assertIn(data["site_name"], (None, "thesujata"))

    @patch("main._fetch_html_best_effort")
    @patch("main._fetch_product_og_metadata")
    def test_refresh_product_metadata_uses_browser_html_fallback_when_direct_fetch_fails(
        self, mock_fetch_og: MagicMock, mock_fetch_html_best_effort: MagicMock
    ) -> None:
        from db import SessionLocal, TrackedProductKeyword, TrackedProductMeta

        url = f"https://smartstore.naver.com/thesujata/products/12874366496?test={uuid.uuid4().hex}"
        normalized_url = url.split("?", 1)[0]

        with SessionLocal() as db:
            db.query(TrackedProductKeyword).filter(TrackedProductKeyword.product_url == normalized_url).delete(
                synchronize_session=False
            )
            db.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == normalized_url).delete(
                synchronize_session=False
            )
            db.add(
                TrackedProductKeyword(
                    product_url=normalized_url,
                    keyword="헤나팩",
                    is_active=True,
                )
            )
            db.commit()

        mock_fetch_og.return_value = None
        mock_fetch_html_best_effort.return_value = (
            """
            <html><head>
            <meta property="og:title" content="헤나 집중 영양팩 : 수자타헤나" />
            <meta property="og:site_name" content="수자타헤나" />
            <meta property="og:image" content="http://example.com/fallback.jpg" />
            </head></html>
            """,
            {"source": "browser"},
        )

        client = TestClient(app)
        resp = client.post("/search-rank/refresh-product-metadata")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(int(data["updated"]), 1)

        with SessionLocal() as db:
            row = (
                db.query(TrackedProductMeta)
                .filter(TrackedProductMeta.product_url == normalized_url)
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(row.title, "헤나 집중 영양팩")
            self.assertEqual(row.image_url, "http://example.com/fallback.jpg")
            self.assertEqual(row.mall_name, "수자타헤나")


if __name__ == "__main__":
    unittest.main()


