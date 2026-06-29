import unittest
from unittest.mock import patch


class HostCdpProbeOverrideTest(unittest.TestCase):
    def test_probe_host_cdp_returns_override_fields_when_client_ip_provided(self) -> None:
        """
        회귀 방지:
        - 브라우저에서 http://<pc>:9223/json/version 을 직접 fetch하면 CORS에 막힐 수 있다.
        - 따라서 서버의 /host-cdp/probe가 client_ip 기반 override probe 결과를 함께 반환해야 한다.
        """
        from fastapi.testclient import TestClient
        import main

        client = TestClient(main.app)

        with (
            patch("main._use_host_chrome", return_value=True),
            patch("main._pick_client_ip_from_request", return_value="192.168.0.52"),
            patch("main._pw_cdp_url", return_value="http://host.docker.internal:9223"),
            patch("main._probe_http_status") as mock_probe,
        ):
            # first call: container_http/json/version, second call: override_http/json/version
            mock_probe.side_effect = [
                (False, None, "container_blocked"),
                (True, 200, None),
            ]

            res = client.get("/search-rank/page-metrics/host-cdp/probe", params={"client_ip": "192.168.0.52"})
            self.assertEqual(res.status_code, 200, msg=res.text)
            body = res.json() or {}
            self.assertTrue(body.get("enabled"))
            self.assertEqual(body.get("picked_ip"), "192.168.0.52")
            self.assertEqual(body.get("override_http"), "http://192.168.0.52:9223")
            self.assertEqual(body.get("override_http_reachable"), True)
            self.assertEqual(body.get("override_http_status"), 200)


if __name__ == "__main__":
    unittest.main()

