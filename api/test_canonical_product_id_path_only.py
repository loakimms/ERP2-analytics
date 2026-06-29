import unittest

from main import _canonical_product_id


class CanonicalProductIdPathOnlyTest(unittest.TestCase):
    def test_canonical_product_id_ignores_products_in_query(self) -> None:
        # path의 pid는 B인데, query(originUrl)에 A의 /products/<pid> 가 포함된 케이스
        pid_a = "777000111222"
        pid_b = "888000333444"
        u = (
            f"https://smartstore.naver.com/test/products/{pid_b}"
            f"?originUrl=https%3A%2F%2Fsmartstore.naver.com%2Fother%2Fproducts%2F{pid_a}"
        )
        self.assertEqual(_canonical_product_id(u), pid_b)


if __name__ == "__main__":
    unittest.main()

