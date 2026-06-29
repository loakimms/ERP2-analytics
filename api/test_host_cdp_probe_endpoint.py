import unittest
from unittest.mock import patch

import main


class HostCdpProbeEndpointTest(unittest.TestCase):
    def test_probe_returns_disabled_when_use_host_chrome_false(self) -> None:
        with patch.object(main, "_use_host_chrome", return_value=False):
            out = main.probe_host_cdp()
        self.assertEqual(bool(out.get("enabled")), False)
        # disabled이면 probe 자체를 강제하지 않는다
        self.assertIsNone(out.get("container_http_reachable"))

    def test_probe_returns_reachable_true_when_probe_ok(self) -> None:
        with patch.object(main, "_use_host_chrome", return_value=True):
            with patch.object(main, "_pw_cdp_url", return_value="http://1.2.3.4:9223"):
                with patch.object(main, "_probe_http_status", return_value=(True, 200, None)):
                    out = main.probe_host_cdp()
        self.assertEqual(bool(out.get("enabled")), True)
        self.assertEqual(out.get("container_http"), "http://1.2.3.4:9223")
        self.assertEqual(out.get("container_http_reachable"), True)


if __name__ == "__main__":
    unittest.main()

