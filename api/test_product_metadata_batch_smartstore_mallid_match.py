import unittest


class ProductMetadataBatchSmartstoreMallIdMatchTest(unittest.TestCase):
    def test_batch_returns_title_when_url_mall_id_matches_even_if_saved_mall_name_is_korean(self) -> None:
        """
        실증 케이스:
        - tracked_product_meta.mall_name 은 OpenAPI mallName(한글 상호)로 저장될 수 있음.
        - URL의 mallId(thesujata)와 불일치하면 과거 로직은 title/image를 숨겨 UI에서 이미지/상품명이 비는 문제가 발생.
        - 해결: mall_name 대신 URL에서 추출한 mallId로 동일성 판정.
        """
        from fastapi.testclient import TestClient
        from main import app
        from db import SessionLocal, TrackedProductMeta

        url = "https://smartstore.naver.com/thesujata/products/4743750201"

        with SessionLocal() as s:
            s.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == url).delete(synchronize_session=False)
            s.add(
                TrackedProductMeta(
                    product_url=url,
                    keyword="테스트키워드",
                    title="정상 상품명",
                    mall_name="수자타헤나",  # URL mallId와 다른 값(표시명)
                    image_url="http://example.com/img.png",
                    price=12345,
                    product_id_catalog=82288271914,  # 실제로는 catalog id로 저장될 수 있음
                )
            )
            s.commit()

        client = TestClient(app)
        resp = client.post(
            "/search-rank/product-metadata/batch",
            json={
                "items": [
                    {
                        "id": url,
                        "keyword": "테스트키워드",
                        "product_url": url,
                    }
                ]
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(url in data)
        self.assertEqual(data[url]["title"], "정상 상품명")
        self.assertEqual(data[url]["image_url"], "http://example.com/img.png")

    def test_batch_strips_trailing_brand_suffix_from_saved_title(self) -> None:
        from fastapi.testclient import TestClient
        from main import app
        from db import SessionLocal, TrackedProductMeta

        url = "https://smartstore.naver.com/thesujata/products/5532661755"

        with SessionLocal() as s:
            s.query(TrackedProductMeta).filter(TrackedProductMeta.product_url == url).delete(synchronize_session=False)
            s.add(
                TrackedProductMeta(
                    product_url=url,
                    keyword="테스트키워드",
                    title="천연 염색약 가루 11개+호호바 오일 : 수자타헤나",
                    mall_name="thesujata",
                    image_url="http://example.com/img.png",
                    price=12345,
                    product_id_catalog=83077157355,
                )
            )
            s.commit()

        client = TestClient(app)
        resp = client.post(
            "/search-rank/product-metadata/batch",
            json={
                "items": [
                    {
                        "id": url,
                        "keyword": "테스트키워드",
                        "product_url": url,
                    }
                ]
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data[url]["title"], "천연 염색약 가루 11개+호호바 오일")
        self.assertEqual(data[url]["image_url"], "http://example.com/img.png")


if __name__ == "__main__":
    unittest.main()

