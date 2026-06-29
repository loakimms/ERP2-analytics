def test_is_service_block_page_detects_variants() -> None:
    # 회귀 방지:
    # - 네이버 차단/오류 문구가 "불가능" / "불가"로 바뀌어도 감지해야
    #   host_cdp 세션 준비/수집이 타임아웃으로 끌려가지 않는다.
    import main

    assert main._is_service_block_page("현재 서비스 접속이 불가능합니다") is True
    assert main._is_service_block_page("현재 서비스 접속이 불가합니다.") is True
    assert main._is_service_block_page("시스템오류") is True
    assert main._is_service_block_page("보안 확인을 완료해 주세요.") is True
    assert main._is_service_block_page("이 절차는 귀하가 실제 사용자임을 확인하여 계정을 안전하게 보호합니다.") is True
    assert main._is_service_block_page("정상 상품 상세 페이지") is False

