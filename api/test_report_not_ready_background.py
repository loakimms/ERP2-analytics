import os
import unittest
from unittest.mock import MagicMock, patch


class ReportNotReadyBackgroundRetryTest(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "NAVER_AD_API_KEY": "adkey",
            "NAVER_AD_API_SECRET": "adsec",
            "NAVER_AD_CUSTOMER_ID": "1234567",
            "NAVER_AD_API_BASE": "https://api.searchad.naver.com",
        },
        clear=False,
    )
    def test_collect_ads_enqueues_background_retry_on_report_not_ready_single(self) -> None:
        import main
        from fastapi import HTTPException

        # 테스트 간 전역 큐 공유 방지
        main._REPORT_NOT_READY_SCHED.clear()

        # _collect_searchad_daily가 REPORT_NOT_READY(503)로 실패하는 상황을 흉내낸다.
        def raise_not_ready(*args, **kwargs):
            raise HTTPException(status_code=503, detail="REPORT_NOT_READY: 20260111 보고서가 아직 준비중입니다")

        with patch("main._collect_searchad_daily", side_effect=raise_not_ready):
            with self.assertRaises(HTTPException):
                main.collect_ads(
                    main.AdsCollectRequest(
                        mode="single",
                        date="2026-01-11",
                        kinds=["creative"],
                        campaigns=None,
                        adgroups=None,
                        verify_missing=True,
                        max_retries=1,
                    )
                )

        jobs = main._REPORT_NOT_READY_SCHED.list_jobs()
        self.assertEqual(len(jobs), 1)
        j = jobs[0]
        self.assertEqual(j.get("date"), "2026-01-11")
        self.assertIn("creative", j.get("kinds") or [])

    @patch.dict(
        os.environ,
        {
            "NAVER_AD_API_KEY": "adkey",
            "NAVER_AD_API_SECRET": "adsec",
            "NAVER_AD_CUSTOMER_ID": "1234567",
            "NAVER_AD_API_BASE": "https://api.searchad.naver.com",
        },
        clear=False,
    )
    def test_retry_tick_processes_due_job_and_clears_on_success(self) -> None:
        import main

        main._REPORT_NOT_READY_SCHED.clear()
        main._REPORT_NOT_READY_SCHED.enqueue(
            date="2026-01-11",
            kinds=("creative",),
            scope_campaigns=None,
            scope_adgroups=None,
            verify_missing=True,
            max_retries=1,
        )

        # tick 시점에 _collect_searchad_daily가 성공하면 큐에서 제거되어야 한다.
        with patch("main._collect_searchad_daily", return_value={"ok": True, "insertedCreative": 1}) as fn:
            # 강제로 due 상태로 만들기 위해 next_run_ts를 과거로 조정
            for j in main._REPORT_NOT_READY_SCHED._jobs.values():
                j["next_run_ts"] = 0.0
            main._REPORT_NOT_READY_SCHED.tick(now_ts=100.0)

        self.assertTrue(fn.called)
        self.assertEqual(len(main._REPORT_NOT_READY_SCHED.list_jobs()), 0)

