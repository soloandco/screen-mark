# Contributing

버그 제보와 개선 PR을 환영합니다.

## 개발

Node.js 22 이상에서 `npm ci`를 실행합니다. `extension/`을 Chrome 확장 관리 화면에 로드하면 빌드 없이 사용할 수 있습니다. 코드를 수정한 뒤 확장 관리 화면에서 새로고침하세요.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Linux에서는 `npx playwright install --with-deps chromium`으로 브라우저 실행 의존성을 준비할 수 있습니다.

## 변경 기준

- 개인 캡처 이미지와 개인정보가 포함된 로그는 커밋하지 않습니다.
- 런타임 외부 전송이나 새로운 권한은 필요성과 영향을 먼저 이슈에서 설명합니다.
- 오류 수정은 재현 조건을, 기능 변경은 사용 흐름과 확인한 결과를 PR에 적어 주세요.
- 전체 페이지 캡처 변경 시 스크롤 위치·원래 스타일 복원과 고정 요소 누락 여부를 확인합니다.

기여한 코드는 프로젝트의 MIT 라이선스로 배포됩니다.
