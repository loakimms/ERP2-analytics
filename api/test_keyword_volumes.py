import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app


class KeywordVolumesApiTest(unittest.TestCase):
    @patch("main._searchad_keywordstool_hint_many")
    @patch("main._searchad_keywordstool")
    def test_keyword_volumes_falls_back_to_single_call_when_hint_many_misses_exact_keyword(
        self, mock_single, mock_hint_many
    ) -> None:
        # hint_many는 '연관 키워드'만 반환하고 입력 키워드 자체를 반환하지 않는 상황을 가정
        mock_hint_many.return_value = (
            [
                {"relKeyword": "연관키워드", "totalSearchQcCnt": 999},
            ],
            None,
        )
        # 단건 호출은 입력 키워드와 동일한 relKeyword 행을 포함한다고 가정
        mock_single.side_effect = [
            ([{"relKeyword": "새치염색", "totalSearchQcCnt": 1234, "monthlyPcQcCnt": 500, "monthlyMobileQcCnt": 734}], None),
            ([{"relKeyword": "헤나", "totalSearchQcCnt": 2222, "monthlyPcQcCnt": 1000, "monthlyMobileQcCnt": 1222}], None),
        ]

        client = TestClient(app)
        resp = client.post("/search-rank/keyword-volumes", json={"keywords": ["새치염색", "헤나"]})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(
            data,
            [
                {"keyword": "새치염색", "monthly_search_volume": 1234, "monthly_search_volume_label": None},
                {"keyword": "헤나", "monthly_search_volume": 2222, "monthly_search_volume_label": None},
            ],
        )


if __name__ == "__main__":
    unittest.main()

