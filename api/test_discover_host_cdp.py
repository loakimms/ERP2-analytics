import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

# 테스트가 repo root에서 실행될 때도 main import가 안정적으로 되도록 보정
sys.path.insert(0, os.path.dirname(__file__))

from main import app  # noqa: E402


class TestDiscoverHostCdp(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_prefers_x_forwarded_for_without_cidr(self) -> None:
        with patch("main._probe_cdp_json_version", new=AsyncMock(return_value=True)) as probe:
            res = self.client.get(
                "/search-rank/page-metrics/discover-host-cdp",
                headers={"x-forwarded-for": "192.168.0.52"},
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("found"))
        self.assertEqual(data.get("ip"), "192.168.0.52")
        self.assertEqual(data.get("method"), "candidate_probe")
        self.assertIsNone(data.get("cidr"))
        probe.assert_awaited()

    def test_returns_candidate_hint_when_header_ip_exists_but_cdp_not_open(self) -> None:
        with patch("main._probe_cdp_json_version", new=AsyncMock(return_value=False)) as probe:
            res = self.client.get(
                "/search-rank/page-metrics/discover-host-cdp",
                headers={"x-forwarded-for": "192.168.0.52"},
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("found"))
        self.assertEqual(data.get("ip"), "192.168.0.52")
        self.assertEqual(data.get("method"), "candidate_hint")
        self.assertEqual(data.get("verified"), False)
        self.assertIsNone(data.get("cidr"))
        probe.assert_awaited()

    def test_ignores_bridge_ip_and_scans_same_lan_as_nas_host(self) -> None:
        async def _probe(*, host: str, port: int, timeout_sec: float = 1.5) -> bool:
            return host == "192.168.0.105"

        with patch("main._probe_cdp_json_version", new=AsyncMock(side_effect=_probe)) as probe:
            res = self.client.get(
                "/search-rank/page-metrics/discover-host-cdp",
                headers={
                    "host": "192.168.0.50:6188",
                    "x-forwarded-for": "172.20.0.1",
                    "x-real-ip": "172.20.0.1",
                    "x-erp2-client-ip": "172.20.0.1",
                },
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("found"))
        self.assertEqual(data.get("ip"), "192.168.0.105")
        self.assertEqual(data.get("method"), "cidr_scan")
        self.assertEqual(data.get("cidr"), "192.168.0.0/24")
        self.assertGreaterEqual(int(data.get("scanned") or 0), 1)
        probe.assert_awaited()

    def test_requires_cidr_when_no_candidate_headers(self) -> None:
        res = self.client.get("/search-rank/page-metrics/discover-host-cdp")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("detail"), "cidr_required")

    def test_cidr_scan_works_with_32(self) -> None:
        with patch("main._probe_cdp_json_version", new=AsyncMock(return_value=True)) as probe:
            res = self.client.get(
                "/search-rank/page-metrics/discover-host-cdp",
                params={"cidr": "192.168.0.52/32"},
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("found"))
        self.assertEqual(data.get("ip"), "192.168.0.52")
        self.assertEqual(data.get("method"), "cidr_scan")
        self.assertEqual(data.get("cidr"), "192.168.0.52/32")
        probe.assert_awaited()


if __name__ == "__main__":
    unittest.main()

