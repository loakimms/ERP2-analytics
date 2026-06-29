// analytics/web 전용 PostCSS 설정
// - 상위 폴더(Repo Root)의 postcss.config.cjs를 따라가면 tailwindcss 의존성이 필요해져
//   단독 테스트/빌드가 깨질 수 있습니다.
// - analytics web은 현재 Tailwind를 사용하지 않으므로 빈 plugins로 고정합니다.
module.exports = {
	plugins: {},
};

